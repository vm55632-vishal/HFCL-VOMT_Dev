'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../lib/api';
import { getSupabase } from '../lib/supabase';
import { Icon } from './icons';

interface Me {
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
}

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
  perm?: string;
}

const MAIN: Item[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <Icon name="grid" /> },
  {
    href: '/cases/new',
    label: 'New vendor request',
    icon: <Icon name="plus" />,
    perm: 'vendor:create',
  },
  { href: '/cases', label: 'My cases', icon: <Icon name="folder" /> },
  {
    href: '/review-queue',
    label: 'Review queue',
    icon: <Icon name="inbox" />,
    perm: 'vendor:read_all',
  },
  { href: '/audit', label: 'Audit trail', icon: <Icon name="list" />, perm: 'audit_log:read' },
];

const ADMIN: Item[] = [
  { href: '/admin/access-requests', label: 'Access requests', icon: <Icon name="userplus" /> },
  { href: '/admin/roles', label: 'Role management', icon: <Icon name="key" /> },
  { href: '/admin/users', label: 'User management', icon: <Icon name="users" /> },
  { href: '/admin/companies', label: 'Companies', icon: <Icon name="building" /> },
  { href: '/admin/categories', label: 'Vendor categories', icon: <Icon name="tag" /> },
  { href: '/admin/workflows', label: 'Workflows', icon: <Icon name="flow" /> },
];

const ADMIN_PERM = 'user:read';

export default function Sidebar() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [adminOpen, setAdminOpen] = useState(true);

  const hidden =
    pathname === '/' || pathname.startsWith('/sign-in') || pathname.startsWith('/pending');

  const load = useCallback(async () => {
    try {
      setMe(await apiFetch<Me>('/auth/me'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
    }
  }, []);

  // The sidebar lives in the root layout, so it stays mounted while you move between pages — it is
  // NOT remounted by navigating from the sign-in page to the app. Load the profile whenever a
  // signed-in page is showing (not just once at app start, which happens on the hidden sign-in
  // page). apiFetch shares/caches /auth/me briefly, so doing this per navigation is cheap and also
  // picks up role changes.
  useEffect(() => {
    if (!hidden) void load();
  }, [hidden, pathname, load]);

  // React to the session changing underneath us (sign-in, sign-out, switching user): refresh the
  // profile on sign-in and clear it on sign-out, so a different user never sees stale data.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setMe(null);
      else if (event === 'SIGNED_IN') void load();
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  async function logout() {
    await getSupabase()
      ?.auth.signOut()
      .catch(() => undefined);
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
    router.push('/sign-in');
  }

  if (hidden) return null;

  const can = (perm?: string) => !perm || (me?.permissions.includes(perm) ?? false);
  const isAdmin = me?.permissions.includes(ADMIN_PERM) ?? false;
  // Parallel review-stage queues — shown to the role that owns each stage.
  const STAGE_QUEUES: { role: string; label: string }[] = [
    { role: 'infosec', label: 'InfoSec queue' },
    { role: 'fcu', label: 'FCU queue' },
    { role: 'operation', label: 'Operation queue' },
    { role: 'legal', label: 'Legal queue' },
    { role: 'sap', label: 'SAP confirmation' },
  ];
  const myQueues = STAGE_QUEUES.filter((q) => me?.roles.includes(q.role));
  // Highlight the single best-matching link (longest href that prefixes the path), so e.g.
  // "/cases/new" activates "New vendor request" rather than also lighting up "My cases".
  const allHrefs = [...MAIN, ...ADMIN].map((i) => i.href);
  const matches = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const bestMatch = allHrefs.filter(matches).sort((a, b) => b.length - a.length)[0];
  const active = (href: string) => href === bestMatch;

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <Link href="/dashboard" className="sidebar__brand">
        <span className="brand-mark">VOP</span>
        <span className="sidebar__brandtext">Vendor Onboarding</span>
      </Link>

      <nav className="sidebar__nav">
        <div className="sidebar__group">
          {MAIN.filter((i) => can(i.perm)).map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={`sidebar__link${active(i.href) ? ' is-active' : ''}`}
            >
              <span className="sidebar__icon">{i.icon}</span>
              {i.label}
            </Link>
          ))}
          {myQueues.map((q) => (
            <Link
              key={q.role}
              href={`/stages/${q.role}`}
              className={`sidebar__link${pathname.startsWith(`/stages/${q.role}`) ? ' is-active' : ''}`}
            >
              <span className="sidebar__icon">
                <Icon name="shield" />
              </span>
              {q.label}
            </Link>
          ))}
        </div>

        {isAdmin && (
          <div className="sidebar__group">
            <button
              type="button"
              className="sidebar__toggle"
              onClick={() => setAdminOpen((v) => !v)}
              aria-expanded={adminOpen}
            >
              <span className="sidebar__icon">
                <Icon name="shield" />
              </span>
              Administration
              <span className={`sidebar__caret${adminOpen ? ' open' : ''}`}>
                <Icon name="chevron" />
              </span>
            </button>
            {adminOpen && (
              <div className="sidebar__sub">
                {ADMIN.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`sidebar__link${active(i.href) ? ' is-active' : ''}`}
                  >
                    <span className="sidebar__icon">{i.icon}</span>
                    {i.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="sidebar__foot">
        {me && (
          <>
            <span className="sidebar__username">{me.name}</span>
            <span className="sidebar__role">{prettyRole(me.roles[0])}</span>
          </>
        )}
        <button className="sidebar__signout" onClick={() => void logout()}>
          <span className="sidebar__icon">
            <Icon name="logout" />
          </span>
          Sign out
        </button>
      </div>
    </aside>
  );
}

function prettyRole(role?: string): string {
  if (!role) return 'Member';
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
