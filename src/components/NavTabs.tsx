'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS: { href: string; label: string; short?: string }[] = [
  { href: '/', label: 'Overview' },
  { href: '/repos', label: 'Repositories', short: 'Repos' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/trends', label: 'Trends' },
];

export default function NavTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  // Keep the selected owner scope when moving between tabs.
  const scope = params.get('scope');
  const suffix = scope ? `?scope=${encodeURIComponent(scope)}` : '';

  return (
    <nav className="tabs">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={`${t.href}${suffix}`}
          className={pathname === t.href ? 'active' : ''}
        >
          {t.short ? (
            <>
              <span className="tab-long">{t.label}</span>
              <span className="tab-short">{t.short}</span>
            </>
          ) : (
            t.label
          )}
        </Link>
      ))}
    </nav>
  );
}
