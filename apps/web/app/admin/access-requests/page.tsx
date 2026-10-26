'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';

interface PendingReq {
  id: string;
  requestedRoles: string[];
  entity: { code: string; name: string } | null;
  justification: string;
  user: { id: string; name: string; email: string; department: string | null };
}

export default function AccessRequests() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingReq[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setPending(await apiFetch<PendingReq[]>('/registrations/pending'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/sign-in');
      else setMsg(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: 'approve' | 'reject', roles: string[]) {
    setMsg(null);
    try {
      await apiFetch(`/registrations/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, roles }),
      });
      setMsg(`Request ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  return (
    <main className="wrap">
      <div className="topbar">
        <div>
          <h1>Access requests</h1>
          <p className="lead">
            Self-registration &amp; role requests awaiting approval · {pending.length}.
          </p>
        </div>
      </div>

      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}

      <section className="card">
        {loaded && pending.length === 0 && (
          <p className="muted">No requests awaiting your approval.</p>
        )}
        {pending.map((r) => (
          <div key={r.id} className="req">
            <div>
              <strong>{r.user.name}</strong> <span className="muted">{r.user.email}</span>
              {r.user.department && <span className="muted"> · {r.user.department}</span>}
              <div className="muted" style={{ marginTop: 2 }}>
                Requests: {r.requestedRoles.join(', ') || '-'} · Company:{' '}
                {r.entity ? r.entity.name : 'not specified'}
              </div>
              {r.justification && <div className="faint">“{r.justification}”</div>}
            </div>
            <div className="req__actions">
              <button
                className="btn btn--sm"
                onClick={() => void decide(r.id, 'approve', r.requestedRoles)}
              >
                Approve
              </button>
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => void decide(r.id, 'reject', [])}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
