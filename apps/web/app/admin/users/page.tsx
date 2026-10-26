'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';

interface Me {
  permissions: string[];
}
interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: { key: string; label: string }[];
  entityRoles: { roleKey: string; role: { label: string }; entity: { code: string } }[];
}

/** "Group: Auditor · HFCL: Proposer, FCU · HHFL: Proposer" */
function describeRoles(u: UserRow): string {
  const parts: string[] = [];
  if (u.roles.length) parts.push(`Group: ${u.roles.map((r) => r.label).join(', ')}`);
  const codes = [...new Set(u.entityRoles.map((r) => r.entity.code))];
  for (const code of codes) {
    const labels = u.entityRoles.filter((r) => r.entity.code === code).map((r) => r.role.label);
    parts.push(`${code}: ${labels.join(', ')}`);
  }
  return parts.join(' · ') || '-';
}

export default function UserManagement() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const profile = await apiFetch<Me>('/auth/me');
      setMe(profile);
      const list = await apiFetch<{ rows: UserRow[] }>('/users?take=200');
      setUsers(list.rows);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/sign-in');
      else setMsg(err instanceof Error ? err.message : 'Failed to load.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED') {
    setMsg(null);
    try {
      await apiFetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setMsg(status === 'ACTIVE' ? 'User activated.' : 'User deactivated.');
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  async function forceLogout(id: string) {
    setMsg(null);
    try {
      await apiFetch(`/users/${id}/force-logout`, { method: 'POST' });
      setMsg('Sessions revoked.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  const canManage = me?.permissions.includes('user:manage') ?? false;
  const canForce = me?.permissions.includes('user:force_logout') ?? false;
  const term = q.trim().toLowerCase();
  const rows = term
    ? users.filter(
        (u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term),
      )
    : users;

  return (
    <main className="wrap">
      <div className="topbar">
        <div>
          <h1>User management</h1>
          <p className="lead">Activate, deactivate and revoke sessions · {users.length} users.</p>
        </div>
      </div>

      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}

      <section className="card">
        <div className="field" style={{ maxWidth: 320 }}>
          <input
            placeholder="Search name or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Roles</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const activeUser = u.status.toLowerCase() === 'active';
              return (
                <tr key={u.id}>
                  <td>
                    {u.name}
                    <div className="muted">{u.email}</div>
                  </td>
                  <td>
                    <span className={`pill ${activeUser ? 'pill--ok' : 'pill--draft'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td>{describeRoles(u)}</td>
                  <td>
                    <div className="req__actions" style={{ justifyContent: 'flex-end' }}>
                      {canManage &&
                        (activeUser ? (
                          <button
                            className="btn btn--sm btn--danger"
                            onClick={() => void setStatus(u.id, 'SUSPENDED')}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => void setStatus(u.id, 'ACTIVE')}
                          >
                            Activate
                          </button>
                        ))}
                      {canForce && (
                        <button
                          className="btn btn--sm btn--ghost"
                          onClick={() => void forceLogout(u.id)}
                        >
                          Force logout
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No users match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
