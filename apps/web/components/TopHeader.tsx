'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';
import EntitySwitcher from './EntitySwitcher';

// Section title shown in the top bar, derived from the current route.
const TITLES: { prefix: string; label: string }[] = [
  { prefix: '/dashboard', label: 'Dashboard' },
  { prefix: '/cases/new', label: 'New case' },
  { prefix: '/cases', label: 'Cases' },
  { prefix: '/review-queue', label: 'Review queue' },
  { prefix: '/audit', label: 'Audit trail' },
  { prefix: '/admin/access-requests', label: 'Access requests' },
  { prefix: '/admin/roles', label: 'Role management' },
  { prefix: '/admin/users', label: 'User management' },
  { prefix: '/admin/companies', label: 'Companies' },
  { prefix: '/admin/categories', label: 'Vendor categories' },
  { prefix: '/admin/workflows', label: 'Workflows' },
  { prefix: '/console', label: 'My access' },
  { prefix: '/privacy', label: 'Privacy Policy' },
  { prefix: '/terms', label: 'Terms of Service' },
];

export default function TopHeader() {
  const pathname = usePathname() ?? '';
  const hidden =
    pathname === '/' || pathname.startsWith('/sign-in') || pathname.startsWith('/pending');
  if (hidden) return null;

  const title = TITLES.find((t) => pathname.startsWith(t.prefix))?.label ?? 'Vendor Onboarding';

  return (
    <header className="appheader">
      <span className="appheader__title">{title}</span>
      <div className="appheader__actions">
        <EntitySwitcher />
        <button className="iconbtn" aria-label="Notifications" type="button">
          <Icon name="bell" size={20} />
          <span className="iconbtn__dot" />
        </button>
        <Link className="iconbtn" href="/console" aria-label="Your account">
          <Icon name="user" size={20} />
        </Link>
      </div>
    </header>
  );
}
