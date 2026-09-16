/**
 * Aggregation / trend engine.
 *
 * Everything here is computed from **one** fetch — the most recent one. There
 * is no archive of daily files to diff.
 *
 * History still works because GitHub stamps every alert with `created_at` and,
 * once closed, `fixed_at` / `dismissed_at`. Replaying those timestamps forward
 * gives an accurate day-by-day curve of how many alerts were open, opened and
 * fixed on any past date, all from a single fetch.
 *
 * The one thing this cannot see is an alert that silently disappeared (repo
 * deleted, Dependabot switched off) — GitHub stops returning it, so it leaves
 * the timeline as of the moment it vanished.
 */

import {
  AgingBucket,
  AlertRecord,
  DailyPoint,
  DashboardData,
  EcosystemBreakdown,
  FixVelocityCell,
  LifecycleRecord,
  OwnerOption,
  OwnerScope,
  RepoMetric,
  RepoRecord,
  RepoTrend,
  SCOPE_ALL,
  SEVERITIES,
  Severity,
  SeverityCounts,
  Snapshot,
  emptySeverityCounts,
} from './types';

const DAY_MS = 86_400_000;
/** Upper bound on how many days of reconstructed trend we generate. */
const MAX_TREND_DAYS = 730;
/** Trailing window used for the "repos increasing / decreasing" lists. */
export const TREND_WINDOW_DAYS = 7;

export function dayKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  return dayKey(new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY_MS));
}

function daysBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < MAX_TREND_DAYS + 2) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard += 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lifecycles                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build one lifecycle record per alert in the fetch.
 *
 * - `openedAt` = GitHub's `created_at`, the real day the alert appeared.
 * - `closedAt` = `fixed_at` / `dismissed_at` when GitHub reports one.
 *
 * Both come straight from the alert payload, so a single fetch is enough to
 * reconstruct the full timeline.
 */
export function buildLifecycles(snapshot: Snapshot | null): LifecycleRecord[] {
  if (!snapshot) return [];

  const today = dayKey(new Date());
  const out: LifecycleRecord[] = [];

  for (const alert of snapshot.alerts) {
    const openedAt = dayKey(alert.createdAt);

    let closedAt: string | null = null;
    let closedState: LifecycleRecord['closedState'] = null;

    if (alert.state === 'fixed') {
      closedAt = dayKey(alert.fixedAt ?? alert.updatedAt);
      closedState = 'fixed';
    } else if (alert.state === 'dismissed' || alert.state === 'auto_dismissed') {
      closedAt = dayKey(alert.dismissedAt ?? alert.updatedAt);
      closedState = alert.state === 'dismissed' ? 'dismissed' : 'auto_dismissed';
    }

    if (closedAt && closedAt < openedAt) closedAt = openedAt;

    out.push({
      key: alert.key,
      repo: alert.repo,
      severity: alert.severity,
      ghsaId: alert.ghsaId,
      packageName: alert.packageName,
      openedAt,
      closedAt,
      closedState,
      ageDays: Math.round(daysBetween(openedAt, closedAt ?? today)),
      resolved: Boolean(closedAt),
    });
  }

  return out.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

/* ------------------------------------------------------------------ */
/* Daily trend series                                                  */
/* ------------------------------------------------------------------ */

/**
 * Replay the lifecycles day by day. `openAlerts` on any given date is the
 * number of alerts whose open interval covers that date.
 */
export function buildDailySeries(
  snapshot: Snapshot | null,
  lifecycles: LifecycleRecord[],
): DailyPoint[] {
  if (!lifecycles.length) return [];

  const today = dayKey(new Date());
  let start = lifecycles[0].openedAt;
  const floor = addDays(today, -MAX_TREND_DAYS);
  if (start < floor) start = floor;
  if (start > today) start = today;

  const dates = dateRange(start, today);
  const reposScanned = snapshot?.meta.reposScanned ?? 0;
  const reposEnabled = snapshot?.meta.reposWithAlertsEnabled ?? 0;

  return dates.map((date) => {
    const bySeverity: SeverityCounts = emptySeverityCounts();
    let open = 0;
    let newAlerts = 0;
    let fixedAlerts = 0;
    let dismissedAlerts = 0;
    const reposWithOpen = new Set<string>();

    for (const lc of lifecycles) {
      if (lc.openedAt === date) newAlerts += 1;
      if (lc.closedAt === date) {
        if (lc.closedState === 'fixed') fixedAlerts += 1;
        else dismissedAlerts += 1;
      }
      const isOpen = lc.openedAt <= date && (!lc.closedAt || lc.closedAt > date);
      if (isOpen) {
        open += 1;
        bySeverity[lc.severity] += 1;
        reposWithOpen.add(lc.repo);
      }
    }

    const isToday = date === today;
    return {
      date,
      openAlerts: open,
      critical: bySeverity.critical,
      high: bySeverity.high,
      medium: bySeverity.medium,
      low: bySeverity.low,
      newAlerts,
      fixedAlerts,
      dismissedAlerts,
      netChange: newAlerts - fixedAlerts - dismissedAlerts,
      reposWithAlerts: reposWithOpen.size,
      // Repo-level counts are only known for the day of the fetch itself.
      reposScanned: isToday ? reposScanned : 0,
      reposEnabled: isToday ? reposEnabled : 0,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 1,
};

/**
 * Risk score = weighted severity load, amplified by how long the oldest open
 * alert has been sitting there (an unfixed critical from 6 months ago is worse
 * than one opened yesterday).
 */
export function riskScore(counts: SeverityCounts, oldestOpenDays: number | null): number {
  const base = SEVERITIES.reduce((sum, s) => sum + counts[s] * SEVERITY_WEIGHT[s], 0);
  if (base === 0) return 0;
  const agingMultiplier = 1 + Math.min(1, (oldestOpenDays ?? 0) / 180);
  return Math.round(base * agingMultiplier * 10) / 10;
}

/** 0-100, higher is healthier. */
export function healthScore(repo: RepoRecord, risk: number): number {
  if (repo.dependabotAlertsEnabled === false) return 35;
  if (repo.dependabotAlertsEnabled === null) return 60;
  const penalty = Math.min(70, risk * 2.5);
  return Math.max(0, Math.round(100 - penalty));
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* Top-level aggregation                                               */
/* ------------------------------------------------------------------ */

export function computeDashboardData(
  snapshot: Snapshot | null,
  scope: OwnerScope = SCOPE_ALL,
  owners: OwnerOption[] = [],
): DashboardData {
  const today = dayKey(new Date());
  const latest = snapshot;
  const lifecycles = buildLifecycles(snapshot);
  const daily = buildDailySeries(snapshot, lifecycles);

  const openAlerts = (latest?.alerts ?? []).filter((a) => a.state === 'open');

  // Oldest open alert per repo, used for aging-aware risk scoring.
  const oldestOpenByRepo = new Map<string, number>();
  for (const lc of lifecycles) {
    if (lc.resolved) continue;
    const age = daysBetween(lc.openedAt, today);
    oldestOpenByRepo.set(lc.repo, Math.max(oldestOpenByRepo.get(lc.repo) ?? 0, age));
  }

  // Per-repo MTTR from resolved-as-fixed lifecycles.
  const fixDurationsByRepo = new Map<string, number[]>();
  const fixDurations: number[] = [];
  const fixDurationsBySeverity = new Map<Severity, number[]>();
  for (const lc of lifecycles) {
    if (lc.closedState !== 'fixed' || !lc.closedAt) continue;
    const days = daysBetween(lc.openedAt, lc.closedAt);
    fixDurations.push(days);
    const arr = fixDurationsByRepo.get(lc.repo) ?? [];
    arr.push(days);
    fixDurationsByRepo.set(lc.repo, arr);
    const sev = fixDurationsBySeverity.get(lc.severity) ?? [];
    sev.push(days);
    fixDurationsBySeverity.set(lc.severity, sev);
  }

  // Net change per repo over a trailing window, derived from alert timestamps
  // (opened minus closed) rather than from comparing two stored fetches.
  const windowStart = addDays(today, -(TREND_WINDOW_DAYS - 1));
  const openedInWindow = new Map<string, number>();
  const closedInWindow = new Map<string, number>();
  for (const lc of lifecycles) {
    if (lc.openedAt >= windowStart) {
      openedInWindow.set(lc.repo, (openedInWindow.get(lc.repo) ?? 0) + 1);
    }
    if (lc.closedAt && lc.closedAt >= windowStart) {
      closedInWindow.set(lc.repo, (closedInWindow.get(lc.repo) ?? 0) + 1);
    }
  }

  const repos: RepoMetric[] = (latest?.repos ?? []).map((repo) => {
    const oldest = oldestOpenByRepo.get(repo.fullName) ?? null;
    const risk = riskScore(repo.openBySeverity, oldest);
    const delta =
      (openedInWindow.get(repo.fullName) ?? 0) - (closedInWindow.get(repo.fullName) ?? 0);
    return {
      ...repo,
      riskScore: risk,
      healthScore: healthScore(repo, risk),
      mttrDays: mean(fixDurationsByRepo.get(repo.fullName) ?? []),
      oldestOpenAlertDays: oldest === null ? null : Math.round(oldest),
      delta,
    };
  });

  const trends: RepoTrend[] = repos
    .filter((r) => r.delta !== 0)
    .map((r) => ({
      fullName: r.fullName,
      current: r.openAlerts,
      previous: Math.max(0, r.openAlerts - r.delta),
      delta: r.delta,
      direction: r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat',
    }));

  const bySeverity = emptySeverityCounts();
  for (const a of openAlerts) bySeverity[a.severity] += 1;

  const last7 = daily.slice(-7);
  const fixesLast7 = last7.reduce((s, d) => s + d.fixedAlerts, 0);
  const newLast7 = last7.reduce((s, d) => s + d.newAlerts, 0);

  const mttrBySeverity: Partial<Record<Severity, number>> = {};
  for (const sev of SEVERITIES) {
    const m = mean(fixDurationsBySeverity.get(sev) ?? []);
    if (m !== null) mttrBySeverity[sev] = m;
  }

  return {
    generatedAt: new Date().toISOString(),
    scope,
    owners,
    hasHistory: Boolean(latest),
    fetchedAt: latest?.meta.takenAt ?? null,
    trendWindowDays: TREND_WINDOW_DAYS,
    latest,
    daily,
    repos: repos.sort((a, b) => b.riskScore - a.riskScore || a.fullName.localeCompare(b.fullName)),
    alerts: openAlerts.sort(
      (a, b) =>
        SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] ||
        a.repo.localeCompare(b.repo),
    ),
    lifecycles,
    totals: {
      repos: latest?.repos.length ?? 0,
      reposEnabled: (latest?.repos ?? []).filter((r) => r.dependabotAlertsEnabled === true).length,
      reposDisabled: (latest?.repos ?? []).filter((r) => r.dependabotAlertsEnabled === false).length,
      reposUnknown: (latest?.repos ?? []).filter((r) => r.dependabotAlertsEnabled === null).length,
      openAlerts: openAlerts.length,
      bySeverity,
      reposWithOpenAlerts: (latest?.repos ?? []).filter((r) => r.openAlerts > 0).length,
      mttrDays: mean(fixDurations),
      mttrBySeverity,
      fixesLast7Days: fixesLast7,
      newLast7Days: newLast7,
      fixVelocityPerDay: Math.round((fixesLast7 / 7) * 100) / 100,
      medianAgeDays: median(
        lifecycles.filter((l) => !l.resolved).map((l) => l.ageDays),
      ),
    },
    ecosystems: buildEcosystems(openAlerts),
    aging: buildAging(lifecycles.filter((l) => !l.resolved)),
    increasing: trends.filter((t) => t.direction === 'up').sort((a, b) => b.delta - a.delta),
    decreasing: trends.filter((t) => t.direction === 'down').sort((a, b) => a.delta - b.delta),
    fixHeatmap: buildFixHeatmap(lifecycles, 84),
  };
}

export function buildEcosystems(openAlerts: AlertRecord[]): EcosystemBreakdown[] {
  const map = new Map<string, EcosystemBreakdown & { repoSet: Set<string> }>();
  for (const a of openAlerts) {
    const entry =
      map.get(a.ecosystem) ??
      {
        ecosystem: a.ecosystem,
        open: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        repos: 0,
        repoSet: new Set<string>(),
      };
    entry.open += 1;
    entry[a.severity] += 1;
    entry.repoSet.add(a.repo);
    map.set(a.ecosystem, entry);
  }
  return [...map.values()]
    .map(({ repoSet, ...rest }) => ({ ...rest, repos: repoSet.size }))
    .sort((a, b) => b.open - a.open);
}

const AGING_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0-7d', min: 0, max: 7 },
  { label: '8-30d', min: 8, max: 30 },
  { label: '31-90d', min: 31, max: 90 },
  { label: '91-180d', min: 91, max: 180 },
  { label: '180d+', min: 181, max: Infinity },
];

export function buildAging(openLifecycles: LifecycleRecord[]): AgingBucket[] {
  return AGING_BUCKETS.map(({ label, min, max }) => {
    const bucket: AgingBucket = { label, count: 0, critical: 0, high: 0, medium: 0, low: 0 };
    for (const lc of openLifecycles) {
      if (lc.ageDays >= min && lc.ageDays <= max) {
        bucket.count += 1;
        bucket[lc.severity] += 1;
      }
    }
    return bucket;
  });
}

/** Fixes per repo per day for the trailing `days` window. */
export function buildFixHeatmap(
  lifecycles: LifecycleRecord[],
  days: number,
): FixVelocityCell[] {
  const today = dayKey(new Date());
  const start = addDays(today, -days);
  const map = new Map<string, FixVelocityCell>();
  for (const lc of lifecycles) {
    if (lc.closedState !== 'fixed' || !lc.closedAt) continue;
    if (lc.closedAt < start) continue;
    const key = `${lc.closedAt}|${lc.repo}`;
    const cell = map.get(key) ?? { date: lc.closedAt, repo: lc.repo, fixes: 0 };
    cell.fixes += 1;
    map.set(key, cell);
  }
  return [...map.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.repo.localeCompare(b.repo),
  );
}
