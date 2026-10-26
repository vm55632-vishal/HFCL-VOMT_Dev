'use client';
import Link from 'next/link';

import { useCallback, useEffect, useState } from 'react';
import { APPROVAL_LEVELS } from '@vop/shared';
import { apiFetch, ApiError } from '../../../lib/api';

interface Category {
  key: string;
  name: string;
  description: string;
  sortOrder: number;
  active: boolean;
  enhancedDueDiligence: boolean;
  requiredDocuments: string[];
  requiredValidations: string[];
  workflowKey: string;
  /** Approval levels (l1/l2/l3) this category's cases run after the reviews. */
  approvalLevels: string[];
}

const empty = {
  key: '',
  name: '',
  description: '',
  workflowKey: 'standard-vendor',
  enhancedDueDiligence: false,
  approvalLevels: [] as string[],
};

export default function CategoriesAdmin() {
  const [rows, setRows] = useState<Category[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await apiFetch<Category[]>('/categories?all=true'));
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Failed to load.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await apiFetch('/categories', {
        method: 'POST',
        body: JSON.stringify({
          key: form.key,
          name: form.name,
          description: form.description,
          workflowKey: form.workflowKey,
          enhancedDueDiligence: form.enhancedDueDiligence,
          approvalLevels: form.approvalLevels,
        }),
      });
      setForm({ ...empty });
      setMsg('Category created.');
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Create failed.');
    }
  }

  // Switch one approval level on or off for a category. Cases already submitted keep their levels.
  async function toggleLevel(cat: Category, level: string) {
    const on = cat.approvalLevels.includes(level);
    const next = on
      ? cat.approvalLevels.filter((l) => l !== level)
      : [...cat.approvalLevels, level];
    setMsg(null);
    setRows((rs) => rs.map((r) => (r.key === cat.key ? { ...r, approvalLevels: next } : r)));
    try {
      await apiFetch(`/categories/${cat.key}`, {
        method: 'PATCH',
        body: JSON.stringify({ approvalLevels: next }),
      });
      setMsg(
        `${cat.name}: ${level.toUpperCase()} approval ${on ? 'turned off' : 'turned on'}. Applies to cases submitted from now on.`,
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Update failed.');
    }
    await load();
  }

  async function toggle(cat: Category) {
    try {
      await apiFetch(`/categories/${cat.key}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !cat.active }),
      });
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Update failed.');
    }
  }

  return (
    <main className="wrap">
      <p className="crumbs">
        <Link href="/console">Console</Link> · <Link href="/admin/workflows">Workflows</Link>
      </p>
      <h1>Vendor categories</h1>
      <p className="lead">Master data for the intake form · {rows.length} categories.</p>
      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}

      <section className="card">
        <h2>New category</h2>
        <form onSubmit={create} className="grid2">
          <label>
            Key (lower_snake_case)
            <input
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              required
            />
          </label>
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label className="span2">
            Description
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label>
            Workflow key
            <input
              value={form.workflowKey}
              onChange={(e) => setForm({ ...form, workflowKey: e.target.value })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.enhancedDueDiligence}
              onChange={(e) => setForm({ ...form, enhancedDueDiligence: e.target.checked })}
            />
            Enhanced due diligence
          </label>
          <fieldset className="span2 lvl-pick">
            <legend>Approval levels after the reviews</legend>
            {APPROVAL_LEVELS.map((l) => (
              <label key={l} className="checkbox">
                <input
                  type="checkbox"
                  checked={form.approvalLevels.includes(l)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      approvalLevels: e.target.checked
                        ? [...form.approvalLevels, l]
                        : form.approvalLevels.filter((x) => x !== l),
                    })
                  }
                />
                {l.toUpperCase()}
              </label>
            ))}
            <span className="field-cap">
              None ticked: cases go straight from the reviews to SAP.
            </span>
          </fieldset>
          <button className="btn span2" type="submit">
            Create category
          </button>
        </form>
      </section>

      <section className="card">
        <h2>All categories</h2>
        <div className="scroll-area">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Workflow</th>
                <th>Flags</th>
                <th>Approval levels</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.key} style={{ opacity: c.active ? 1 : 0.5 }}>
                  <td>
                    {c.name}
                    <div className="muted">{c.requiredValidations.join(', ')}</div>
                  </td>
                  <td>
                    <code>{c.key}</code>
                  </td>
                  <td>{c.workflowKey}</td>
                  <td>
                    {c.enhancedDueDiligence ? <span className="pill">enhanced DD</span> : '-'}
                  </td>
                  <td>
                    <div
                      className="lvl-toggles"
                      role="group"
                      aria-label={`Approval levels for ${c.name}`}
                    >
                      {APPROVAL_LEVELS.map((l) => (
                        <label key={l} className="checkbox">
                          <input
                            type="checkbox"
                            checked={(c.approvalLevels ?? []).includes(l)}
                            onChange={() => void toggleLevel(c, l)}
                          />
                          {l.toUpperCase()}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className="pill">{c.active ? 'active' : 'inactive'}</span>
                  </td>
                  <td>
                    <button className="btn btn--sm btn--ghost" onClick={() => void toggle(c)}>
                      {c.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
