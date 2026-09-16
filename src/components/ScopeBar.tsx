import { OwnerOption, OwnerScope } from '@/lib/types';
import { Suspense } from 'react';
import ScopeSelector from './ScopeSelector';

/** Scope selector plus a plain-language description of the active slice. */
export default function ScopeBar({
  owners,
  scope,
  repos,
  openAlerts,
}: {
  owners: OwnerOption[];
  scope: OwnerScope;
  repos: number;
  openAlerts: number;
}) {
  const active = owners.find((o) => o.value === scope);
  return (
    <div className="scope-bar">
      <Suspense fallback={<span className="muted">Scope…</span>}>
        <ScopeSelector owners={owners} scope={scope} />
      </Suspense>
      <span className="muted">
        Showing <strong>{active?.label ?? 'All repositories'}</strong> — {repos} repo
        {repos === 1 ? '' : 's'}, {openAlerts} open alert{openAlerts === 1 ? '' : 's'}. All metrics on
        this page are recomputed for this scope.
      </span>
    </div>
  );
}
