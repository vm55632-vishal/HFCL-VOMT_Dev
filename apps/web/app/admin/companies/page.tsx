'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';

interface Company {
  id: string;
  code: string;
  name: string;
  emailDomains: string[];
  active: boolean;
}

const splitDomains = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((d) => d.trim())
    .filter(Boolean);

/**
 * ADR-0008: the companies in the group. The email domains decide which company a newly signed-in
 * person asks for access to; access itself is always granted through roles, never by the domain.
 */
export default function Companies() {
  const router = useRouter();
  const [rows, setRows] = useState<Company[]>([]);
  const [edits, setEdits] = useState<Record<string, { name: string; domains: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ code: '', name: '', domains: '' });

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<Company[]>('/entities/all');
      setRows(list);
      setEdits(
        Object.fromEntries(
          list.map((c) => [c.code, { name: c.name, domains: c.emailDomains.join(', ') }]),
        ),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/sign-in');
      else setMsg(err instanceof Error ? err.message : 'Failed to load.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="wrap">
      <div className="topbar">
        <div>
          <h1>Companies</h1>
          <p className="lead">
            The companies in the group. Each person works only in the companies where they hold a
            role. Email domains only decide which company a new person asks for access to.
          </p>
        </div>
      </div>

      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}

      <section className="card">
        <div className="scroll-area scroll-area--x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Email domains</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const e = edits[c.code] ?? { name: c.name, domains: c.emailDomains.join(', ') };
                const changed = e.name !== c.name || e.domains !== c.emailDomains.join(', ');
                return (
                  <tr key={c.code}>
                    <td>
                      <code className="caseid">{c.code}</code>
                    </td>
                    <td>
                      <input
                        aria-label={`${c.code} name`}
                        value={e.name}
                        maxLength={200}
                        onChange={(ev) =>
                          setEdits((p) => ({ ...p, [c.code]: { ...e, name: ev.target.value } }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${c.code} email domains`}
                        value={e.domains}
                        placeholder="e.g. herofincorp.com"
                        onChange={(ev) =>
                          setEdits((p) => ({ ...p, [c.code]: { ...e, domains: ev.target.value } }))
                        }
                      />
                    </td>
                    <td>
                      <span className={`pill ${c.active ? 'pill--ok' : 'pill--draft'}`}>
                        {c.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="req__actions" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn--sm"
                          disabled={!changed || busy !== null}
                          onClick={() =>
                            void run(
                              c.code,
                              () =>
                                apiFetch(`/entities/${c.code}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({
                                    name: e.name,
                                    emailDomains: splitDomains(e.domains),
                                  }),
                                }),
                              `${c.code} saved.`,
                            )
                          }
                        >
                          {busy === c.code ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="btn btn--sm btn--ghost"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(
                              c.code + ':active',
                              () =>
                                apiFetch(`/entities/${c.code}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ active: !c.active }),
                                }),
                              c.active ? `${c.code} deactivated.` : `${c.code} activated.`,
                            )
                          }
                        >
                          {c.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Add a company</h2>
        <form
          className="grid2"
          onSubmit={(ev) => {
            ev.preventDefault();
            void run(
              'new',
              () =>
                apiFetch('/entities', {
                  method: 'POST',
                  body: JSON.stringify({
                    code: draft.code,
                    name: draft.name,
                    emailDomains: splitDomains(draft.domains),
                  }),
                }),
              `${draft.code.toUpperCase()} added. Give people roles in it from Role management.`,
            ).then(() => setDraft({ code: '', name: '', domains: '' }));
          }}
        >
          <label>
            Code
            <input
              value={draft.code}
              required
              maxLength={12}
              pattern="[A-Za-z0-9]{2,12}"
              title="2–12 letters or digits"
              placeholder="e.g. HHFL"
              onChange={(ev) => setDraft((d) => ({ ...d, code: ev.target.value.toUpperCase() }))}
            />
          </label>
          <label>
            Name
            <input
              value={draft.name}
              required
              maxLength={200}
              placeholder="Company legal name"
              onChange={(ev) => setDraft((d) => ({ ...d, name: ev.target.value }))}
            />
          </label>
          <label className="span2">
            Email domains (comma separated)
            <input
              value={draft.domains}
              placeholder="e.g. herohfl.com"
              onChange={(ev) => setDraft((d) => ({ ...d, domains: ev.target.value }))}
            />
          </label>
          <div>
            <button className="btn" type="submit" disabled={busy !== null}>
              {busy === 'new' ? 'Adding…' : 'Add company'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
