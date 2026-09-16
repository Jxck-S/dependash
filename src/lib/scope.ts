/**
 * Owner scoping: "show me only my personal repos", "only orgs", or one
 * specific owner.
 *
 * Filtering happens on the raw snapshots *before* aggregation, so every derived
 * number — trends, MTTR, churn, fix velocity — is recomputed for the selected
 * scope rather than merely hiding table rows.
 */

import {
  OWNER_PREFIX,
  OwnerOption,
  OwnerScope,
  SCOPE_ALL,
  SCOPE_ORGS,
  SCOPE_PERSONAL,
  Snapshot,
} from './types';

/**
 * Older snapshots (schema v1, before ownerType was recorded) have
 * `ownerType === null`. Fall back to "anything that isn't the authenticated
 * user is an organization", which is how GitHub accounts are usually laid out.
 */
export function ownerTypeOf(
  repo: { owner: string; ownerType?: 'User' | 'Organization' | null },
  viewer: string,
): 'User' | 'Organization' {
  if (repo.ownerType) return repo.ownerType;
  return repo.owner.toLowerCase() === viewer.toLowerCase() ? 'User' : 'Organization';
}

export function normalizeScope(raw: string | string[] | undefined): OwnerScope {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return SCOPE_ALL;
  const trimmed = value.trim();
  if (!trimmed) return SCOPE_ALL;
  if (trimmed === SCOPE_ALL || trimmed === SCOPE_PERSONAL || trimmed === SCOPE_ORGS) {
    return trimmed;
  }
  if (trimmed.startsWith(OWNER_PREFIX)) return trimmed;
  // Bare owner login, e.g. ?scope=my-org
  return `${OWNER_PREFIX}${trimmed}`;
}

export function scopeMatches(
  repo: { owner: string; ownerType?: 'User' | 'Organization' | null },
  scope: OwnerScope,
  viewer: string,
): boolean {
  if (scope === SCOPE_ALL) return true;
  if (scope === SCOPE_PERSONAL) {
    return repo.owner.toLowerCase() === viewer.toLowerCase();
  }
  if (scope === SCOPE_ORGS) {
    return ownerTypeOf(repo, viewer) === 'Organization';
  }
  if (scope.startsWith(OWNER_PREFIX)) {
    return repo.owner.toLowerCase() === scope.slice(OWNER_PREFIX.length).toLowerCase();
  }
  return true;
}

export function scopeLabel(scope: OwnerScope, viewer: string): string {
  if (scope === SCOPE_PERSONAL) return `${viewer} (personal)`;
  if (scope === SCOPE_ORGS) return 'All organizations';
  if (scope.startsWith(OWNER_PREFIX)) return scope.slice(OWNER_PREFIX.length);
  return 'All repositories';
}

/** Apply a scope to the fetch, dropping repos and their alerts. */
export function applyScope(snapshot: Snapshot | null, scope: OwnerScope): Snapshot | null {
  if (!snapshot || scope === SCOPE_ALL) return snapshot;
  const viewer = snapshot.meta.viewer;
  const repos = snapshot.repos.filter((r) => scopeMatches(r, scope, viewer));
  const keep = new Set(repos.map((r) => r.fullName));
  return {
    ...snapshot,
    meta: {
      ...snapshot.meta,
      reposScanned: repos.length,
      reposWithAlertsEnabled: repos.filter((r) => r.dependabotAlertsEnabled === true).length,
      reposSkipped: repos.filter((r) => r.error).length,
    },
    repos,
    alerts: snapshot.alerts.filter((a) => keep.has(a.repo)),
  };
}

export function buildOwnerOptions(latest: Snapshot | null): OwnerOption[] {
  if (!latest) return [];
  const viewer = latest.meta.viewer;

  const openByRepo = new Map<string, number>();
  for (const repo of latest.repos) openByRepo.set(repo.fullName, repo.openAlerts);

  const owners = new Map<string, OwnerOption>();
  for (const repo of latest.repos) {
    const type = ownerTypeOf(repo, viewer);
    const entry =
      owners.get(repo.owner) ??
      ({
        value: `${OWNER_PREFIX}${repo.owner}`,
        label: repo.owner,
        kind: 'owner',
        ownerType: type,
        repos: 0,
        openAlerts: 0,
      } satisfies OwnerOption);
    entry.repos += 1;
    entry.openAlerts += openByRepo.get(repo.fullName) ?? 0;
    owners.set(repo.owner, entry);
  }

  const list = [...owners.values()];
  const personal = list.filter((o) => o.label.toLowerCase() === viewer.toLowerCase());
  const orgs = list.filter((o) => o.ownerType === 'Organization');
  const others = list
    .filter((o) => o.ownerType !== 'Organization' && o.label.toLowerCase() !== viewer.toLowerCase());

  const sum = (rows: OwnerOption[], key: 'repos' | 'openAlerts') =>
    rows.reduce((total, row) => total + row[key], 0);

  const options: OwnerOption[] = [
    {
      value: SCOPE_ALL,
      label: 'All repositories',
      kind: 'all',
      ownerType: null,
      repos: latest.repos.length,
      openAlerts: sum(list, 'openAlerts'),
    },
  ];

  if (personal.length) {
    options.push({
      value: SCOPE_PERSONAL,
      label: `${viewer} (personal)`,
      kind: 'personal',
      ownerType: 'User',
      repos: sum(personal, 'repos'),
      openAlerts: sum(personal, 'openAlerts'),
    });
  }
  if (orgs.length) {
    options.push({
      value: SCOPE_ORGS,
      label: `All organizations (${orgs.length})`,
      kind: 'orgs',
      ownerType: 'Organization',
      repos: sum(orgs, 'repos'),
      openAlerts: sum(orgs, 'openAlerts'),
    });
  }

  const byName = (a: OwnerOption, b: OwnerOption) => a.label.localeCompare(b.label);
  options.push(...orgs.sort(byName), ...others.sort(byName));
  return options;
}
