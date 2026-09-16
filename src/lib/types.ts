/**
 * Core data model for dependash.
 *
 * Everything in this file describes data that lives *locally*, in a single
 * last-fetch JSON file. Nothing here is ever written back to GitHub.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export type AlertState = 'open' | 'fixed' | 'dismissed' | 'auto_dismissed';

/** Per-severity integer counters. */
export type SeverityCounts = Record<Severity, number>;

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

/** A single Dependabot alert, normalized from the GitHub REST API. */
export interface AlertRecord {
  /** Stable key across snapshots: "owner/repo#number". */
  key: string;
  repo: string;
  number: number;
  state: AlertState;
  severity: Severity;
  /** GHSA id, e.g. GHSA-xxxx-xxxx-xxxx. */
  ghsaId: string | null;
  cveId: string | null;
  summary: string;
  cvssScore: number | null;
  /** npm, pip, maven, nuget, rubygems, go, composer, rust, actions, ... */
  ecosystem: string;
  packageName: string;
  manifestPath: string | null;
  vulnerableVersionRange: string | null;
  firstPatchedVersion: string | null;
  scope: 'development' | 'runtime' | null;
  createdAt: string;
  updatedAt: string;
  fixedAt: string | null;
  dismissedAt: string | null;
  dismissedReason: string | null;
  /** Deep link to the alert in the GitHub UI. */
  htmlUrl: string;
  /** Deep link to the GHSA advisory. */
  advisoryUrl: string | null;
}

/** Why we believe Dependabot alerts are or are not enabled for a repo. */
export type EnablementSource =
  | 'vulnerability-alerts-api'
  | 'security-and-analysis'
  | 'alerts-api-403'
  | 'alerts-api-ok'
  | 'archived'
  | 'unknown';

export interface RepoRecord {
  /** "owner/name" */
  fullName: string;
  owner: string;
  /** Whether the owner is a user account or an organization. */
  ownerType: 'User' | 'Organization' | null;
  name: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  disabled: boolean;
  defaultBranch: string;
  language: string | null;
  stars: number;
  pushedAt: string | null;
  htmlUrl: string;
  /** https://github.com/<owner>/<repo>/security/dependabot */
  dependabotUrl: string;
  /** null == could not be determined (usually insufficient permission). */
  dependabotAlertsEnabled: boolean | null;
  dependabotSecurityUpdatesEnabled: boolean | null;
  enablementSource: EnablementSource;
  /** Non-fatal problem encountered while collecting this repo. */
  error: string | null;
  openAlerts: number;
  openBySeverity: SeverityCounts;
  fixedAlerts: number;
  dismissedAlerts: number;
}

export interface SnapshotMeta {
  /** YYYY-MM-DD (local time) the fetch was taken. */
  date: string;
  /** Full ISO timestamp of when the fetch ran. */
  takenAt: string;
  /** Authenticated login used to collect this snapshot. */
  viewer: string;
  source: 'github-api' | 'dependamate';
  toolVersion: string;
  reposScanned: number;
  reposWithAlertsEnabled: number;
  reposSkipped: number;
  durationMs: number;
  /** Non-fatal errors encountered during collection. */
  errors: string[];
}

/** The single stored fetch. */
export interface Snapshot {
  schemaVersion: 1;
  meta: SnapshotMeta;
  repos: RepoRecord[];
  alerts: AlertRecord[];
}

/* ------------------------------------------------------------------ */
/* Aggregated / derived metrics (computed at read time, never stored)  */
/* ------------------------------------------------------------------ */

export interface DailyPoint {
  date: string;
  openAlerts: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** Alerts observed for the first time on this date (churn in). */
  newAlerts: number;
  /** Alerts that transitioned open -> fixed on this date (churn out). */
  fixedAlerts: number;
  dismissedAlerts: number;
  /** newAlerts - fixedAlerts - dismissedAlerts. */
  netChange: number;
  reposWithAlerts: number;
  reposScanned: number;
  reposEnabled: number;
}

export interface LifecycleRecord {
  key: string;
  repo: string;
  severity: Severity;
  ghsaId: string | null;
  packageName: string;
  /** Alert createdAt from GitHub, falling back to first snapshot sighting. */
  openedAt: string;
  closedAt: string | null;
  closedState: 'fixed' | 'dismissed' | 'auto_dismissed' | null;
  /** Days between openedAt and closedAt (or now, if still open). */
  ageDays: number;
  resolved: boolean;
}

export interface RepoTrend {
  fullName: string;
  /** Open alerts right now. */
  current: number;
  /** Implied open count at the start of the trend window. */
  previous: number;
  delta: number;
  direction: 'up' | 'down' | 'flat';
}

export interface RepoMetric extends RepoRecord {
  /** Weighted risk score: 10*crit + 5*high + 2*med + 1*low, scaled by staleness. */
  riskScore: number;
  /** 0-100, higher is healthier. */
  healthScore: number;
  /** Mean days-to-fix for this repo's resolved alerts (null if none). */
  mttrDays: number | null;
  /** Oldest currently-open alert, in days. */
  oldestOpenAlertDays: number | null;
  /** Change in open alerts vs the previous snapshot. */
  delta: number;
}

export interface EcosystemBreakdown {
  ecosystem: string;
  open: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  repos: number;
}

export interface AgingBucket {
  label: string;
  count: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface FixVelocityCell {
  /** ISO week-day label or date. */
  date: string;
  repo: string;
  fixes: number;
}

/**
 * Which slice of the account the dashboard is showing.
 *   'all'       – everything in the snapshot
 *   'personal'  – repos owned by the authenticated user
 *   'orgs'      – repos owned by any organization
 *   'owner:foo' – repos owned by exactly `foo`
 */
export type OwnerScope = string;

export const SCOPE_ALL = 'all';
export const SCOPE_PERSONAL = 'personal';
export const SCOPE_ORGS = 'orgs';
export const OWNER_PREFIX = 'owner:';

export interface OwnerOption {
  /** Scope value to put in the ?scope= query string. */
  value: OwnerScope;
  label: string;
  kind: 'all' | 'personal' | 'orgs' | 'owner';
  ownerType: 'User' | 'Organization' | null;
  repos: number;
  openAlerts: number;
}

export interface DashboardData {
  generatedAt: string;
  /** The owner scope these numbers were computed for. */
  scope: OwnerScope;
  /** Every owner present in the latest snapshot, for the scope selector. */
  owners: OwnerOption[];
  /** True once a fetch has been collected. */
  hasHistory: boolean;
  /** ISO timestamp of the fetch these numbers came from. */
  fetchedAt: string | null;
  /** Trailing window (days) behind the increasing/decreasing lists. */
  trendWindowDays: number;
  latest: Snapshot | null;
  daily: DailyPoint[];
  repos: RepoMetric[];
  alerts: AlertRecord[];
  lifecycles: LifecycleRecord[];
  totals: {
    repos: number;
    reposEnabled: number;
    reposDisabled: number;
    reposUnknown: number;
    openAlerts: number;
    bySeverity: SeverityCounts;
    reposWithOpenAlerts: number;
    mttrDays: number | null;
    mttrBySeverity: Partial<Record<Severity, number>>;
    fixesLast7Days: number;
    newLast7Days: number;
    fixVelocityPerDay: number;
    medianAgeDays: number | null;
  };
  ecosystems: EcosystemBreakdown[];
  aging: AgingBucket[];
  increasing: RepoTrend[];
  decreasing: RepoTrend[];
  fixHeatmap: FixVelocityCell[];
}
