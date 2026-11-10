/**
 * Fix triage: for every open Dependabot alert, work out whether Dependabot's
 * own pull request already fixes it, whether that PR is healthy, or whether
 * the alert needs a human (or an AI agent) to fix it by hand.
 *
 * Read-only like the rest of dependash: every call goes through GitHubClient,
 * which only issues GETs. Where a fix needs a write (turning on security
 * updates, `@dependabot recreate`, pushing a branch), the result tells the
 * agent which `gh` command to run with its own credentials.
 */

import { GitHubClient, GitHubError, RawAlert, mapWithConcurrency, normalizeAlert } from './github';
import { AlertRecord, Severity } from './types';

/* ------------------------------ types ------------------------------ */

export type CiState = 'passing' | 'failing' | 'pending' | 'none';

export interface DependabotPr {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  branch: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  /** Packages this PR bumps, with the version it moves each one to. */
  bumps: { packageName: string; from: string | null; to: string | null }[];
  /** Open PRs only. */
  ci?: CiState;
  failingChecks?: { name: string; url: string | null }[];
  /** GitHub's mergeable_state: clean, dirty (conflicts), blocked, behind, unstable, unknown. */
  mergeableState?: string;
  /** Alert numbers this PR covers. */
  alerts: number[];
}

export type Bucket =
  | 'dependabot_pr_ready'
  | 'dependabot_pr_ci_pending'
  | 'dependabot_pr_ci_failing'
  | 'dependabot_pr_conflicts'
  | 'dependabot_pr_insufficient'
  | 'dependabot_pr_closed'
  | 'merged_but_still_open'
  | 'security_updates_disabled'
  | 'security_updates_paused'
  | 'waiting_for_dependabot'
  | 'dependabot_did_not_open_pr'
  | 'no_patch_available'
  | 'no_pr_settings_unknown';

export type NextAction =
  | 'review_dependabot_pr'
  | 'wait'
  | 'fix_on_pr_branch'
  | 'rebase_or_recreate_pr'
  | 'enable_security_updates'
  | 'manual_fix'
  | 'human_decision';

export interface TriagedAlert {
  number: number;
  severity: Severity;
  packageName: string;
  ecosystem: string;
  manifestPath: string | null;
  vulnerableVersionRange: string | null;
  firstPatchedVersion: string | null;
  ghsaId: string | null;
  summary: string;
  url: string;
  bucket: Bucket;
  action: NextAction;
  /** The Dependabot PR this alert hinges on, if any. */
  pr: number | null;
  reason: string;
}

export interface SecurityUpdates {
  /** null = the token can't see the setting (needs admin on the repo). */
  enabled: boolean | null;
  paused: boolean | null;
  /** Whether the signed-in user can change it. */
  canEnable: boolean;
}

export interface RepoTriage {
  repo: string;
  defaultBranch: string | null;
  securityUpdates: SecurityUpdates;
  openAlerts: number;
  alerts: TriagedAlert[];
  /** Dependabot PRs that relate to at least one open alert. */
  pullRequests: DependabotPr[];
  /** Ordered, concrete steps for the agent. */
  nextSteps: string[];
  counts: Partial<Record<NextAction, number>>;
  error?: string;
}

const DEPENDABOT_LOGIN = 'dependabot[bot]';
const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
/** How long Dependabot normally needs to open a security PR for a new alert. */
const DEPENDABOT_GRACE_MS = 24 * 60 * 60 * 1000;

/* -------------------------- pure helpers --------------------------- */

/**
 * Loose version comparison that works for semver and most ecosystems'
 * dotted versions. Returns null when either side isn't recognisably numeric.
 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => {
    const m = v.trim().replace(/^[v=]+/i, '').match(/^(\d+(?:\.\d+)*)(.*)$/);
    if (!m) return null;
    return { nums: m[1].split('.').map(Number), pre: m[2].replace(/^[-+.]/, '') };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  // 1.2.0-rc1 < 1.2.0; ignore build metadata-ish suffixes otherwise.
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  return pa.pre === pb.pre ? 0 : pa.pre < pb.pre ? -1 : 1;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pull "package X from A to B" out of a Dependabot PR title and body. Handles
 * single bumps ("Bumps [lodash](…) from 4.17.20 to 4.17.21."), grouped ones
 * ("Updates `lodash` from 4.17.20 to 4.17.21"), and the title form.
 */
export function bumpFor(pkg: string, title: string, body: string): { from: string | null; to: string | null } | null {
  const name = escapeRe(pkg);
  const re = new RegExp(
    `(?:^|[\\s\\[\`(/])${name}(?:\\]\\([^)]*\\))?\`?\\s+from\\s+\`?v?([^\\s\`]+?)\`?\\s+to\\s+\`?v?([^\\s\`]+?)\`?(?=\\.?(?:[\\s,;)]|$))`,
    'im',
  );
  for (const text of [title, body]) {
    const m = text.match(re);
    if (m) return { from: m[1], to: m[2] };
  }
  // Mentioned, but without a parsable range (e.g. grouped title only).
  const mention = new RegExp(`(?:^|[\\s\\[\`(/])${name}(?:[\\]\`\\s,.;)]|$)`, 'im');
  return mention.test(title) || mention.test(body) ? { from: null, to: null } : null;
}

/** Directory a Dependabot PR title targets ("… in /frontend"), if stated. */
export function prDirectory(title: string): string | null {
  const m = title.match(/\sin\s+(\/[^\s]*)\s*$/);
  return m ? normalizeDir(m[1]) : null;
}

export function manifestDir(manifestPath: string | null): string | null {
  if (!manifestPath) return null;
  const i = manifestPath.lastIndexOf('/');
  return normalizeDir(i < 0 ? '/' : `/${manifestPath.slice(0, i)}`);
}

function normalizeDir(d: string): string {
  const s = `/${d.replace(/^\/+|\/+$/g, '')}`;
  return s === '/' ? '/' : s;
}

/** Dependabot branch ecosystem segment → alert ecosystems it can fix. */
const BRANCH_ECOSYSTEMS: Record<string, string[]> = {
  npm_and_yarn: ['npm'],
  bun: ['npm'],
  pip: ['pip'],
  uv: ['pip'],
  bundler: ['rubygems'],
  cargo: ['rust'],
  go_modules: ['go'],
  maven: ['maven'],
  gradle: ['maven'],
  nuget: ['nuget'],
  composer: ['composer'],
  github_actions: ['actions'],
  pub: ['pub'],
  hex: ['erlang'],
  swift: ['swift'],
};

function ecosystemCompatible(branch: string, ecosystem: string): boolean {
  const seg = branch.split('/')[1];
  const allowed = seg ? BRANCH_ECOSYSTEMS[seg] : undefined;
  return !allowed || allowed.includes(ecosystem.toLowerCase());
}

interface RawPull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  head: { ref: string; sha: string };
}

/** Does this Dependabot PR touch this alert's package (and directory)? */
export function matchPr(alert: AlertRecord, pr: { title: string; body: string | null; head: { ref: string } }) {
  if (!pr.head.ref.startsWith('dependabot/')) return null;
  if (!ecosystemCompatible(pr.head.ref, alert.ecosystem)) return null;
  const dir = prDirectory(pr.title);
  const want = manifestDir(alert.manifestPath);
  if (dir && want && dir !== want) return null;
  return bumpFor(alert.packageName, pr.title, pr.body ?? '');
}

/** Does bumping to `to` reach the alert's first patched version? */
export function reachesPatch(to: string | null, patched: string | null): boolean | null {
  if (!to || !patched) return null;
  const c = compareVersions(to, patched);
  return c === null ? null : c >= 0;
}

export function summarizeCi(
  checkRuns: { status: string; conclusion: string | null; name: string; html_url?: string | null }[],
  statuses: { state: string; context: string; target_url?: string | null }[],
): { ci: CiState; failing: { name: string; url: string | null }[] } {
  const failing: { name: string; url: string | null }[] = [];
  let pending = false;
  const bad = new Set(['failure', 'timed_out', 'action_required', 'startup_failure', 'cancelled']);
  for (const r of checkRuns) {
    if (r.status !== 'completed') pending = true;
    else if (r.conclusion && bad.has(r.conclusion)) failing.push({ name: r.name, url: r.html_url ?? null });
  }
  for (const s of statuses) {
    if (s.state === 'pending') pending = true;
    else if (s.state === 'failure' || s.state === 'error') failing.push({ name: s.context, url: s.target_url ?? null });
  }
  if (failing.length) return { ci: 'failing', failing };
  if (pending) return { ci: 'pending', failing };
  return { ci: checkRuns.length + statuses.length ? 'passing' : 'none', failing };
}

/** Decide what to do about one alert, given the PR evidence. */
export function classify(
  alert: AlertRecord,
  pr: (DependabotPr & { reaches: boolean | null }) | null,
  updates: SecurityUpdates,
  now = Date.now(),
): Pick<TriagedAlert, 'bucket' | 'action' | 'reason'> {
  if (pr?.state === 'open') {
    if (pr.reaches === false) {
      const bump = pr.bumps.find((b) => b.packageName === alert.packageName);
      return {
        bucket: 'dependabot_pr_insufficient',
        action: 'fix_on_pr_branch',
        reason: `PR #${pr.number} bumps ${alert.packageName} to ${bump?.to}, but the first patched version is ${alert.firstPatchedVersion}.`,
      };
    }
    if (pr.mergeableState === 'dirty') {
      return { bucket: 'dependabot_pr_conflicts', action: 'rebase_or_recreate_pr', reason: `PR #${pr.number} has merge conflicts.` };
    }
    if (pr.ci === 'failing') {
      return {
        bucket: 'dependabot_pr_ci_failing',
        action: 'fix_on_pr_branch',
        reason: `PR #${pr.number} fails: ${(pr.failingChecks ?? []).map((c) => c.name).join(', ') || 'checks'}.`,
      };
    }
    if (pr.ci === 'pending') {
      return { bucket: 'dependabot_pr_ci_pending', action: 'wait', reason: `PR #${pr.number} checks are still running.` };
    }
    return {
      bucket: 'dependabot_pr_ready',
      action: 'review_dependabot_pr',
      reason:
        `PR #${pr.number} ${pr.ci === 'none' ? 'has no CI checks' : 'passes CI'}` +
        (pr.reaches === null ? '; confirm it reaches the patched version.' : ' and reaches the patched version.'),
    };
  }
  if (pr?.state === 'merged') {
    return {
      bucket: 'merged_but_still_open',
      action: 'manual_fix',
      reason: `Dependabot PR #${pr.number} was merged but the alert is still open — the vulnerable version is still resolved somewhere (another lockfile entry, a transitive pin, or a different manifest).`,
    };
  }
  if (pr?.state === 'closed') {
    return {
      bucket: 'dependabot_pr_closed',
      action: 'rebase_or_recreate_pr',
      reason: `Dependabot PR #${pr.number} was closed without merging; Dependabot won't reopen it on its own.`,
    };
  }
  if (!alert.firstPatchedVersion) {
    return {
      bucket: 'no_patch_available',
      action: 'human_decision',
      reason: 'No patched version exists. Replace the package, mitigate, or dismiss with a reason — a human call.',
    };
  }
  if (updates.enabled === false) {
    return {
      bucket: 'security_updates_disabled',
      action: updates.canEnable ? 'enable_security_updates' : 'manual_fix',
      reason: updates.canEnable
        ? 'Dependabot security updates are off, so no PR was created. Turning them on makes Dependabot open PRs.'
        : 'Dependabot security updates are off and you are not an admin of this repo.',
    };
  }
  if (updates.paused) {
    return {
      bucket: 'security_updates_paused',
      action: updates.canEnable ? 'enable_security_updates' : 'manual_fix',
      reason: 'Dependabot security updates are paused (usually after the repo went inactive).',
    };
  }
  if (updates.enabled === null) {
    return {
      bucket: 'no_pr_settings_unknown',
      action: 'manual_fix',
      reason: 'No Dependabot PR, and the security-updates setting is not visible to you (needs admin).',
    };
  }
  if (now - Date.parse(alert.createdAt) < DEPENDABOT_GRACE_MS) {
    return { bucket: 'waiting_for_dependabot', action: 'wait', reason: 'Alert is under a day old; Dependabot may still open a PR.' };
  }
  return {
    bucket: 'dependabot_did_not_open_pr',
    action: 'manual_fix',
    reason:
      'Security updates are on but Dependabot opened no PR — usually it could not resolve a fixed version (transitive dependency, peer conflict, or unsupported manifest). See the alert page for its error.',
  };
}

/* ----------------------------- fetching ---------------------------- */

export async function fetchOpenAlerts(gh: GitHubClient, repo: string): Promise<AlertRecord[]> {
  const raw = await gh.paginate<RawAlert>(`/repos/${repo}/dependabot/alerts?state=open&per_page=100`, 10);
  return raw.map((a) => normalizeAlert(repo, a));
}

async function securityUpdates(gh: GitHubClient, repo: string): Promise<{ updates: SecurityUpdates; defaultBranch: string | null }> {
  let canEnable = false;
  let defaultBranch: string | null = null;
  try {
    const r = await gh.get<{ default_branch: string; permissions?: { admin?: boolean } }>(`/repos/${repo}`);
    canEnable = !!r.permissions?.admin;
    defaultBranch = r.default_branch;
  } catch {
    /* fall through */
  }
  const { status, body } = await gh.request(`/repos/${repo}/automated-security-fixes`);
  if (status === 200 && body && typeof body === 'object') {
    const b = body as { enabled?: boolean; paused?: boolean };
    return { updates: { enabled: !!b.enabled, paused: !!b.paused, canEnable }, defaultBranch };
  }
  return { updates: { enabled: null, paused: null, canEnable }, defaultBranch };
}

async function prDetails(gh: GitHubClient, repo: string, pr: RawPull): Promise<Pick<DependabotPr, 'ci' | 'failingChecks' | 'mergeableState'>> {
  const [detail, runs, status] = await Promise.all([
    gh.get<{ mergeable_state?: string }>(`/repos/${repo}/pulls/${pr.number}`).catch(() => null),
    gh
      .get<{ check_runs: { status: string; conclusion: string | null; name: string; html_url: string | null }[] }>(
        `/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`,
      )
      .catch(() => ({ check_runs: [] })),
    gh
      .get<{ statuses: { state: string; context: string; target_url: string | null }[] }>(`/repos/${repo}/commits/${pr.head.sha}/status`)
      .catch(() => ({ statuses: [] })),
  ]);
  const { ci, failing } = summarizeCi(runs.check_runs, status.statuses);
  return { ci, failingChecks: failing, mergeableState: detail?.mergeable_state ?? 'unknown' };
}

export function filterSeverity(alerts: AlertRecord[], min?: Severity): AlertRecord[] {
  if (!min) return alerts;
  return alerts.filter((a) => SEVERITY_RANK[a.severity] >= SEVERITY_RANK[min]);
}

export async function triageRepo(gh: GitHubClient, repo: string, minSeverity?: Severity): Promise<RepoTriage> {
  const empty: RepoTriage = {
    repo,
    defaultBranch: null,
    securityUpdates: { enabled: null, paused: null, canEnable: false },
    openAlerts: 0,
    alerts: [],
    pullRequests: [],
    nextSteps: [],
    counts: {},
  };
  let alerts: AlertRecord[];
  try {
    alerts = filterSeverity(await fetchOpenAlerts(gh, repo), minSeverity);
  } catch (err) {
    const msg = err instanceof GitHubError ? `${err.status}: ${err.message}` : (err as Error).message;
    return { ...empty, error: `Could not read alerts: ${msg}` };
  }
  alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.number - b.number);

  const [{ updates, defaultBranch }, pulls] = await Promise.all([
    securityUpdates(gh, repo),
    alerts.length
      ? gh.get<RawPull[]>(`/repos/${repo}/pulls?state=all&per_page=100&sort=updated&direction=desc`).catch(() => [] as RawPull[])
      : Promise.resolve([] as RawPull[]),
  ]);
  const dependabotPulls = pulls.filter((p) => p.user?.login === DEPENDABOT_LOGIN);

  // For each alert, the most relevant PR: an open one first, else the newest.
  const prs = new Map<number, DependabotPr>();
  const picked = new Map<number, { pr: RawPull; bump: { from: string | null; to: string | null } }>();
  for (const a of alerts) {
    let best: { pr: RawPull; bump: { from: string | null; to: string | null } } | null = null;
    for (const p of dependabotPulls) {
      const bump = matchPr(a, p);
      if (!bump) continue;
      if (!best || (p.state === 'open' && best.pr.state !== 'open')) best = { pr: p, bump };
      if (best.pr.state === 'open') break; // pulls are newest-first
    }
    if (best) picked.set(a.number, best);
  }

  for (const [num, { pr: p, bump }] of picked) {
    const alert = alerts.find((a) => a.number === num)!;
    let rec = prs.get(p.number);
    if (!rec) {
      rec = {
        number: p.number,
        title: p.title,
        url: p.html_url,
        state: p.state === 'open' ? 'open' : p.merged_at ? 'merged' : 'closed',
        branch: p.head.ref,
        headSha: p.head.sha,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        bumps: [],
        alerts: [],
      };
      prs.set(p.number, rec);
    }
    rec.alerts.push(num);
    if (!rec.bumps.some((b) => b.packageName === alert.packageName)) {
      rec.bumps.push({ packageName: alert.packageName, ...bump });
    }
  }

  await mapWithConcurrency(
    [...prs.values()].filter((p) => p.state === 'open'),
    4,
    async (p) => {
      Object.assign(p, await prDetails(gh, repo, pulls.find((x) => x.number === p.number)!));
    },
  );

  const triaged: TriagedAlert[] = alerts.map((a) => {
    const pick = picked.get(a.number);
    const pr = pick ? prs.get(pick.pr.number)! : null;
    const verdict = classify(a, pr ? { ...pr, reaches: reachesPatch(pick!.bump.to, a.firstPatchedVersion) } : null, updates);
    return {
      number: a.number,
      severity: a.severity,
      packageName: a.packageName,
      ecosystem: a.ecosystem,
      manifestPath: a.manifestPath,
      vulnerableVersionRange: a.vulnerableVersionRange,
      firstPatchedVersion: a.firstPatchedVersion,
      ghsaId: a.ghsaId,
      summary: a.summary,
      url: a.htmlUrl,
      pr: pr?.number ?? null,
      ...verdict,
    };
  });

  const counts: Partial<Record<NextAction, number>> = {};
  for (const t of triaged) counts[t.action] = (counts[t.action] ?? 0) + 1;

  return {
    repo,
    defaultBranch,
    securityUpdates: updates,
    openAlerts: alerts.length,
    alerts: triaged,
    pullRequests: [...prs.values()].sort((a, b) => a.number - b.number),
    nextSteps: nextSteps(repo, triaged),
    counts,
  };
}

/** Turn the triage into an ordered to-do list with the exact commands to run. */
export function nextSteps(repo: string, alerts: TriagedAlert[]): string[] {
  const steps: string[] = [];
  const by = (action: NextAction) => alerts.filter((a) => a.action === action);
  const prList = (list: TriagedAlert[]) => [...new Set(list.map((a) => a.pr).filter((n): n is number => n !== null))];
  const alertList = (list: TriagedAlert[]) => list.map((a) => `#${a.number} ${a.packageName} (${a.severity})`).join(', ');

  if (!alerts.length) return ['No open alerts — nothing to do.'];

  const enable = by('enable_security_updates');
  if (enable.length) {
    steps.push(
      `Turn on Dependabot security updates so it opens PRs for ${enable.length} alert(s): \`gh api -X PUT repos/${repo}/automated-security-fixes\` — then re-run triage_alerts in a few minutes. If Dependabot still opens nothing for an alert, fix it manually.`,
    );
  }
  const review = prList(by('review_dependabot_pr'));
  if (review.length) {
    steps.push(
      `Review Dependabot PR(s) ${review.map((n) => `#${n}`).join(', ')} with get_dependabot_pr: check the diff, changelog and breaking changes. If it is good and the user has allowed merging, \`gh pr merge <n> -R ${repo} --squash\`; otherwise report it as ready.`,
    );
  }
  const onBranch = prList(by('fix_on_pr_branch'));
  if (onBranch.length) {
    steps.push(
      `Dependabot PR(s) ${onBranch.map((n) => `#${n}`).join(', ')} need work: inspect with get_dependabot_pr, then \`gh pr checkout <n> -R ${repo}\`, fix the failing build/tests or bump further to the patched version, and push to the same branch (note: Dependabot stops rebasing a PR once someone else pushes to it).`,
    );
  }
  const recreate = prList(by('rebase_or_recreate_pr'));
  if (recreate.length) {
    steps.push(
      `PR(s) ${recreate.map((n) => `#${n}`).join(', ')} are conflicted or were closed: comment \`gh pr comment <n> -R ${repo} --body "@dependabot recreate"\` (or "@dependabot rebase" for an open PR with conflicts). If that is not possible, fix manually.`,
    );
  }
  const wait = by('wait');
  if (wait.length) steps.push(`Wait and re-run triage_alerts for: ${alertList(wait)}.`);
  const manual = by('manual_fix');
  if (manual.length) {
    steps.push(
      `Fix by hand (no usable Dependabot PR): ${alertList(manual)}. Call manual_fix_prompt for repo ${repo} with these alert numbers for full instructions, and open one PR for them.`,
    );
  }
  const human = by('human_decision');
  if (human.length) steps.push(`Ask the user what to do (no patched version exists): ${alertList(human)}.`);
  return steps;
}

/** Alerts that still need hands-on work after Dependabot has had its go. */
export function manualAlerts(triage: RepoTriage): number[] {
  return triage.alerts.filter((a) => a.action === 'manual_fix' || a.bucket === 'dependabot_pr_insufficient').map((a) => a.number);
}
