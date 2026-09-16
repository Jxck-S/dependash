/**
 * Server-side data access for the dashboard.
 *
 * This is the only place the UI touches the filesystem. It reads the single
 * last-fetch file, applies the selected owner scope, and runs the aggregation
 * engine. No network, no database, no GitHub writes.
 */

import 'server-only';
import { readSnapshot, snapshotFile } from './store';
import { computeDashboardData } from './metrics';
import { applyScope, buildOwnerOptions, normalizeScope } from './scope';
import { DashboardData, OwnerScope, SCOPE_ALL } from './types';

export function getDashboardData(scope: OwnerScope = SCOPE_ALL): DashboardData {
  const latest = readSnapshot();
  const owners = buildOwnerOptions(latest);

  // Fall back to "all" if the requested owner isn't present in the fetch.
  const known = new Set(owners.map((o) => o.value));
  const resolved = known.has(scope) ? scope : SCOPE_ALL;

  return computeDashboardData(applyScope(latest, resolved), resolved, owners);
}

/** Resolve a ?scope= search param into a valid scope value. */
export function resolveScope(raw: string | string[] | undefined): OwnerScope {
  return normalizeScope(raw);
}

/** Freshness info for the header: when we last fetched, and from where. */
export function getFetchInfo(): { file: string; fetchedAt: string | null } {
  return { file: snapshotFile(), fetchedAt: readSnapshot()?.meta.takenAt ?? null };
}
