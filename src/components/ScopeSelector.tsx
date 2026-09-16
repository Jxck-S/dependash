'use client';

/**
 * Owner scope selector. Writes ?scope=… into the URL so the server recomputes
 * every metric for the chosen slice (personal / orgs / a single owner) and the
 * choice survives refreshes, bookmarks and tab switches.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { OwnerOption, OwnerScope } from '@/lib/types';

export default function ScopeSelector({
  owners,
  scope,
}: {
  owners: OwnerOption[];
  scope: OwnerScope;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (owners.length <= 1) return null;

  const fixed = owners.filter((o) => o.kind !== 'owner');
  const orgs = owners.filter((o) => o.kind === 'owner' && o.ownerType === 'Organization');
  const users = owners.filter((o) => o.kind === 'owner' && o.ownerType !== 'Organization');

  const onChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === 'all') next.delete('scope');
    else next.set('scope', value);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const option = (o: OwnerOption) => (
    <option key={o.value} value={o.value}>
      {o.label} · {o.repos} repo{o.repos === 1 ? '' : 's'}
      {o.openAlerts ? ` · ${o.openAlerts} open` : ''}
    </option>
  );

  return (
    <label className="scope-picker" title="Recomputes all metrics for the selected owner">
      <span className="muted">Scope</span>
      <select value={scope} onChange={(e) => onChange(e.target.value)}>
        {fixed.map(option)}
        {orgs.length > 0 && <optgroup label="Organizations">{orgs.map(option)}</optgroup>}
        {users.length > 0 && <optgroup label="Other users">{users.map(option)}</optgroup>}
      </select>
    </label>
  );
}
