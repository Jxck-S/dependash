/**
 * Turns the last fetch into everything a dashboard page renders: applies the
 * selected owner scope and runs the aggregation engine. Pure — runs in the
 * browser on whatever snapshot the DataProvider loaded.
 */

import { computeDashboardData } from './metrics';
import { applyScope, buildOwnerOptions, normalizeScope } from './scope';
import { DashboardData, OwnerScope, SCOPE_ALL, Snapshot } from './types';

export function getDashboardData(latest: Snapshot | null, scope: OwnerScope = SCOPE_ALL): DashboardData {
  const owners = buildOwnerOptions(latest);

  // Fall back to "all" if the requested owner isn't present in the fetch.
  const known = new Set(owners.map((o) => o.value));
  const resolved = known.has(scope) ? scope : SCOPE_ALL;

  return computeDashboardData(applyScope(latest, resolved), resolved, owners);
}

/** Resolve a ?scope= search param into a valid scope value. */
export function resolveScope(raw: string | string[] | null | undefined): OwnerScope {
  return normalizeScope(raw ?? undefined);
}
