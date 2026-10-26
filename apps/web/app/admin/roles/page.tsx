'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';

// ADR-0008: these apply in every company in the group.
const GROUP_ROLES: { key: string; label: string; hint: string }[] = [
  { key: 'super_admin', label: 'Super Admin', hint: 'Platform configuration, every company' },
  { key: 'platform_admin', label: 'Platform Admin', hint: 'Users, roles, workflows, companies' },
  { key: 'auditor', label: 'Auditor', hint: 'Read-only access to records and the audit log' },
];

// Roles held separately in each company.
const COMPANY_ROLES: { key: string; label: string }[] = [
  { key: 'proposer', label: 'Proposer' },
  { key: 'infosec', label: 'InfoSec' },
  { key: 'fcu', label: 'FCU (Fraud Control Unit)' },
  { key: 'operation', label: 'Operation' },
  { key: 'legal', label: 'Legal' },
  { key: 'l1', label: 'L1 Approver' },
  { key: 'l2', label: 'L2 Approver' },
  { key: 'l3', label: 'L3 Approver' },
  { key: 'sap', label: 'SAP Confirmation' },
  { key: 'approver', label: 'Reviewer / Approver' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'finance', label: 'Finance & Treasury' },
  { key: 'compliance', label: 'Compliance' },
];

interface Entity {
  code: string;
  name: string;
}
interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: { key: string; label: string }[];
  entityRoles: { roleKey: string; role: { label: string }; entity: Entity }[];
}

const sameSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));

export default function RoleManagement() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [company, setCompany] = useState('');
  const [groupChecked, setGroupChecked] = useState<Set<string>>(new Set());
  const [companyChecked, setCompanyChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, me] = await Promise.all([
        apiFetch<{ rows: UserRow[] }>('/users?take=200'),
        apiFetch<{ entities: Entity[] }>('/auth/me'),
      ]);
      setUsers(list.rows);
      setEntities(me.entities);
      setCompany((c) => c || me.entities[0]?.code || '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/sign-in');
      else setMsg(err instanceof Error ? err.message : 'Failed to load.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => users.find((u) => u.id === selectedId), [users, selectedId]);
  const savedGroup = useMemo(() => selected?.roles.map((r) => r.key) ?? [], [selected]);
  const savedCompany = useMemo(
    () =>
      selected?.entityRoles.filter((r) => r.entity.code === company).map((r) => r.roleKey) ?? [],
    [selected, company],
  );

  // Reset the tick boxes whenever the user or company changes, or after a save reloads the list.
  useEffect(() => setGroupChecked(new Set(savedGroup)), [savedGroup]);
  useEffect(() => setCompanyChecked(new Set(savedCompany)), [savedCompany]);

  const toggle = (set: (fn: (p: Set<string>) => Set<string>) => void, key: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function save(body: Record<string, unknown>, done: string) {
    if (!selected) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/users/${selected.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg(done);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  const companyName = entities.find((e) => e.code === company)?.name ?? company;

  return (
    <main className="wrap">
      <div className="topbar">
        <div>
          <h1>Role management</h1>
          <p className="lead">
            Give each person roles per company. Group-wide roles apply in every company.
            Authorization is enforced on the server.
          </p>
        </div>
      </div>

      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}

      <section className="card">
        <label className="field" style={{ maxWidth: 420 }}>
          User
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setMsg(null);
            }}
          >
            <option value="">Select a user…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.email}
              </option>
            ))}
          </select>
        </label>

        {selected && (
          <div className="rolesplit">
            <section className="rolebox">
              <h3>Roles by company</h3>
              <label className="field" style={{ maxWidth: 360 }}>
                Company
                <select value={company} onChange={(e) => setCompany(e.target.value)}>
                  {entities.map((e) => (
                    <option key={e.code} value={e.code}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rolegrid">
                {COMPANY_ROLES.map((r) => (
                  <label key={r.key} className="checkbox">
                    <input
                      type="checkbox"
                      checked={companyChecked.has(r.key)}
                      onChange={() => toggle(setCompanyChecked, r.key)}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
              <button
                className="btn"
                disabled={busy || !company || sameSet(companyChecked, savedCompany)}
                onClick={() =>
                  void save(
                    { entityRoles: { entityCode: company, roleKeys: [...companyChecked] } },
                    `Roles in ${companyName} updated for ${selected.name}.`,
                  )
                }
              >
                {busy ? 'Saving…' : `Save roles in ${company}`}
              </button>
              <p className="muted tiny">
                Current access:{' '}
                {selected.entityRoles.length
                  ? [...new Set(selected.entityRoles.map((r) => r.entity.code))]
                      .map(
                        (code) =>
                          `${code}: ${selected.entityRoles
                            .filter((r) => r.entity.code === code)
                            .map((r) => r.role.label)
                            .join(', ')}`,
                      )
                      .join(' · ')
                  : 'no company roles'}
              </p>
            </section>

            <section className="rolebox">
              <h3>Group-wide roles</h3>
              <p className="muted tiny">These give access to every company in the group.</p>
              <div className="rolegrid rolegrid--one">
                {GROUP_ROLES.map((r) => (
                  <label key={r.key} className="checkbox">
                    <input
                      type="checkbox"
                      checked={groupChecked.has(r.key)}
                      onChange={() => toggle(setGroupChecked, r.key)}
                    />
                    <span>
                      {r.label} <span className="muted tiny">· {r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <button
                className="btn btn--ghost"
                disabled={busy || sameSet(groupChecked, savedGroup)}
                onClick={() =>
                  void save(
                    { groupRoleKeys: [...groupChecked] },
                    `Group-wide roles updated for ${selected.name}.`,
                  )
                }
              >
                {busy ? 'Saving…' : 'Save group-wide roles'}
              </button>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
