'use client';
import Link from 'next/link';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, apiFetchSwr, ApiError } from '../../lib/api';
import { SkeletonCards, SkeletonRows } from '../../components/Skeleton';
import { Icon } from '../../components/icons';

interface Stats {
  scope: string;
  total: number;
  active: number;
  overdue: number;
  reviewRequired: number;
  byStage: { stage: string; count: number }[];
  byTier: { tier: string; count: number }[];
}
interface Me {
  name: string;
  status?: string;
  roles: string[];
}
interface CaseRow {
  id: string;
  ref: string;
  legalName: string;
  tradeName?: string;
  categoryKey: string;
  subCategoryName?: string | null;
  stage: string;
  tier: string;
  onHold: boolean;
  infosecRequired: boolean;
  dueAt: string | null;
  createdAt: string;
}

// Standard pipeline order → a progress percentage for the bar.
const STAGE_PROGRESS: Record<string, number> = {
  infosec: 8,
  draft: 10,
  review: 50,
  procurement: 35,
  risk: 55,
  finance: 75,
  approval: 90,
  sap: 90,
  approved: 100,
  rejected: 100,
  cancelled: 0,
};

// Parallel review roles that get a queue-scoped ("assigned to me for action") dashboard.
const STAGE_ROLES = ['infosec', 'fcu', 'operation', 'legal', 'sap'];
const ROLE_LABEL: Record<string, string> = {
  infosec: 'InfoSec',
  fcu: 'FCU',
  operation: 'Operation',
  legal: 'Legal',
  sap: 'SAP confirmation',
};

type StatusKind = 'approved' | 'rejected' | 'cancelled' | 'action' | 'progress';
function statusOf(c: CaseRow): { kind: StatusKind; label: string } {
  if (c.stage === 'approved') return { kind: 'approved', label: 'Approved' };
  if (c.stage === 'rejected') return { kind: 'rejected', label: 'Rejected' };
  if (c.stage === 'cancelled') return { kind: 'cancelled', label: 'Cancelled' };
  if (c.stage === 'infosec' || c.infosecRequired)
    return { kind: 'action', label: 'InfoSec review' };
  if (c.onHold) return { kind: 'action', label: 'Action required' };
  return { kind: 'progress', label: 'In progress' };
}
const STATUS_PILL: Record<StatusKind, string> = {
  approved: 'pill--ok',
  rejected: 'pill--danger',
  cancelled: 'pill--draft',
  action: 'pill--warn',
  progress: 'pill--info',
};

function prettyCategory(key: string): string {
  return key
    .replace(/^vendor_/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Newest first; the proposer's overview only shows the latest six. */
const sortRecent = (cases: CaseRow[], limit: boolean): CaseRow[] => {
  const sorted = [...cases].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return limit ? sorted.slice(0, 6) : sorted;
};

// Which dashboard this person got last time: a reviewer role, or "none". Knowing it lets us ask for
// the data in the same moment as "who am I" instead of one request after the other.
const HINT_KEY = 'vop.dashboard-role';
const readHint = (): string | null => {
  try {
    return sessionStorage.getItem(HINT_KEY);
  } catch {
    return null;
  }
};
const saveHint = (role: string | null) => {
  try {
    sessionStorage.setItem(HINT_KEY, role ?? 'none');
  } catch {
    /* private mode: just no head start */
  }
};

export default function Dashboard() {
  const router = useRouter();
  const [s, setS] = useState<Stats | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [queueRole, setQueueRole] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // The dashboard is the landing page after sign-in, so it also has to cope with a visitor who
      // isn't signed in (back to sign-in) or whose access is still awaiting approval.
      const hint = readHint();
      const guess = hint && hint !== 'none' ? hint : null;
      const early = hint
        ? {
            role: guess,
            stats: guess
              ? null
              : apiFetchSwr<Stats>('/stats/dashboard', (c) => setS(c)).then(
                  (v) => ({ ok: true as const, v }),
                  (e: unknown) => ({ ok: false as const, e }),
                ),
            cases: apiFetchSwr<CaseRow[]>(guess ? `/cases?queue=${guess}` : '/cases', (c) =>
              setRows(sortRecent(c, !guess)),
            ).catch(() => [] as CaseRow[]),
          }
        : null;
      const meResult = await apiFetch<Me>('/auth/me').then(
        (m) => ({ me: m, status: 200 }),
        (err) => ({ me: null, status: err instanceof ApiError ? err.status : 0 }),
      );
      if (meResult.status === 401) {
        router.replace('/sign-in');
        return;
      }
      const meRes = meResult.me;
      if (meRes?.status === 'PENDING_APPROVAL') {
        router.replace('/pending');
        return;
      }
      setMe(meRes);
      const role = meRes?.roles.find((r) => STAGE_ROLES.includes(r)) ?? null;
      saveHint(role);
      setQueueRole(role);

      if (role) {
        // Reviewer: the dashboard only shows cases assigned to them for action (their queue).
        const cases =
          early && early.role === role
            ? await early.cases
            : await apiFetch<CaseRow[]>(`/cases?queue=${role}`).catch(() => [] as CaseRow[]);
        setRows(sortRecent(cases, false));
        setS(null);
      } else {
        let stats: Stats;
        let cases: CaseRow[];
        if (early && early.role === null && early.stats) {
          const first = await early.stats;
          if (!first.ok) throw first.e;
          stats = first.v;
          cases = await early.cases;
        } else {
          [stats, cases] = await Promise.all([
            apiFetchSwr<Stats>('/stats/dashboard', (c) => setS(c)),
            apiFetchSwr<CaseRow[]>('/cases', (c) => setRows(sortRecent(c, true))).catch(
              () => [] as CaseRow[],
            ),
          ]);
        }
        setS(stats);
        setRows(sortRecent(cases, true));
      }
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Failed to load.');
    }
  }, [router]);
  useEffect(() => {
    void load();
  }, [load]);

  const approved = s?.byStage.find((x) => x.stage === 'approved')?.count ?? 0;
  const rejected = s?.byStage.find((x) => x.stage === 'rejected')?.count ?? 0;
  const firstName = me?.name?.split(' ')[0] ?? '';
  const isReviewer = !!queueRole;
  const q = rows ?? [];
  const byTier = (t: string) => q.filter((c) => c.tier === t).length;

  return (
    <main className="wrap">
      <header className="dashhead">
        <h1>Welcome{firstName ? `, ${firstName}` : ''}</h1>
        <p className="lead">
          {isReviewer
            ? `Cases assigned to you for ${ROLE_LABEL[queueRole!] ?? queueRole} review.`
            : 'Track your vendor onboarding requests and their progress.'}
        </p>
      </header>

      {msg && <p className="error">{msg}</p>}

      {isReviewer ? (
        rows === null ? (
          <SkeletonCards count={4} />
        ) : (
          <div className="statgrid">
            <StatCard icon="inbox" tone="warn" n={q.length} label="Awaiting my action" />
            <StatCard icon="x" tone="danger" n={byTier('critical')} label="Critical" />
            <StatCard icon="layers" tone="info" n={byTier('high')} label="High risk" />
            <StatCard
              icon="check"
              tone="ok"
              n={byTier('low') + byTier('medium')}
              label="Standard"
            />
          </div>
        )
      ) : !s ? (
        <SkeletonCards count={4} />
      ) : (
        <div className="statgrid">
          <StatCard icon="layers" tone="info" n={s.total} label="Total cases" />
          <StatCard icon="clock" tone="warn" n={s.active} label="In progress" />
          <StatCard icon="check" tone="ok" n={approved} label="Approved" />
          <StatCard icon="x" tone="danger" n={rejected} label="Rejected" />
        </div>
      )}

      <section className="card">
        <div className="card__head">
          <h2>{isReviewer ? 'Awaiting my review' : 'My recent cases'}</h2>
          <Link href={isReviewer ? `/stages/${queueRole}` : '/cases'} className="link-more">
            View all
          </Link>
        </div>
        {rows === null ? (
          <SkeletonRows count={5} />
        ) : rows.length === 0 ? (
          <p className="muted">
            {isReviewer ? (
              'Nothing is awaiting your review right now.'
            ) : (
              <>
                No cases yet. <Link href="/cases/new">Raise your first case</Link>.
              </>
            )}
          </p>
        ) : (
          <div className="scroll-area scroll-area--x">
            <table className="tbl tbl--inline">
              <thead>
                <tr>
                  <th>Case ID</th>
                  <th>Legal name of the business</th>
                  <th>Trade name</th>
                  <th>Category</th>
                  <th>Submitted on</th>
                  <th>Status</th>
                  <th>Overall progress</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const st = isReviewer
                    ? { kind: 'action' as StatusKind, label: 'Awaiting your review' }
                    : statusOf(c);
                  const pct = STAGE_PROGRESS[c.stage] ?? 50;
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/cases/${c.id}`} className="caseref">
                          {c.ref}
                        </Link>
                      </td>
                      <td>{c.legalName}</td>
                      <td>{c.tradeName || <span className="muted">{'—'}</span>}</td>
                      <td className="muted">{c.subCategoryName || '—'}</td>
                      <td className="muted">
                        {new Date(c.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td>
                        <span className={`pill ${STATUS_PILL[st.kind]}`}>{st.label}</span>
                      </td>
                      <td>
                        <div className="progress">
                          <span className="progress__track">
                            <span
                              className={`progress__fill progress__fill--${st.kind}`}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className="progress__val">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function StatCard({
  icon,
  tone,
  n,
  label,
}: {
  icon: string;
  tone: 'info' | 'ok' | 'warn' | 'danger';
  n: number;
  label: string;
}) {
  return (
    <div className="statcard">
      <span className={`statcard__icon statcard__icon--${tone}`}>
        <Icon name={icon} size={22} />
      </span>
      <span className="statcard__body">
        <span className="statcard__n">{n}</span>
        <span className="statcard__l">{label}</span>
      </span>
    </div>
  );
}
