/**
 * Shared collection logic.
 *
 * Both entry points use this single implementation:
 *   - the CLI runner  (scripts/snapshot.ts)
 *   - the UI button   (src/app/api/snapshot/route.ts)
 *
 * Still read-only toward GitHub: it delegates to GitHubClient, which issues
 * GET requests exclusively.
 */

import { GitHubClient, CollectOptions, resolveToken } from './github';
import { runExternalScanner } from './dependamate';
import { localDateString, writeSnapshot } from './store';
import { AlertRecord, RepoRecord, Snapshot, emptySeverityCounts } from './types';

export const TOOL_VERSION = 'dependash@1.0.0';

export interface RunOptions extends CollectOptions {
  /** Override the snapshot date / filename. */
  date?: string;
  /** Max 100-alert pages per repo. */
  maxAlertPages?: number;
  /** Shell command for an external scanner (e.g. DependaMate). */
  dependamate?: string;
  /** Explicit token; otherwise env vars then `gh auth token`. */
  token?: string;
  log?: (msg: string) => void;
}

export interface RunResult {
  snapshot: Snapshot;
  file: string;
  openAlerts: number;
}

export async function runSnapshot(opts: RunOptions = {}): Promise<RunResult> {
  const startedAt = Date.now();
  const log = opts.log ?? (() => {});
  const token = resolveToken(opts.token);
  const client = new GitHubClient({
    token,
    log,
    maxAlertPages: opts.maxAlertPages ?? 20,
  });

  const viewer = await client.viewer();
  const rl = await client.rateLimit();
  log(`authenticated as ${viewer} (core rate limit: ${rl.remaining}/${rl.limit})`);

  let repos: RepoRecord[];
  let alerts: AlertRecord[];
  let source: Snapshot['meta']['source'] = 'github-api';

  if (opts.dependamate) {
    log(`running external scanner: ${opts.dependamate}`);
    const external = runExternalScanner(opts.dependamate);
    log(`external scanner returned ${external.length} alerts`);

    const rawRepos = await client.listRepos(opts);
    repos = [];
    for (const raw of rawRepos) {
      const probe = await client.checkEnablement(raw).catch(() => ({
        enabled: null as boolean | null,
        source: 'unknown' as const,
      }));
      repos.push({
        fullName: raw.full_name,
        owner: raw.owner.login,
        ownerType: raw.owner.type ?? null,
        name: raw.name,
        private: raw.private,
        archived: raw.archived,
        fork: raw.fork,
        disabled: raw.disabled,
        defaultBranch: raw.default_branch,
        language: raw.language,
        stars: raw.stargazers_count,
        pushedAt: raw.pushed_at,
        htmlUrl: raw.html_url,
        dependabotUrl: `https://github.com/${raw.full_name}/security/dependabot`,
        dependabotAlertsEnabled: probe.enabled,
        dependabotSecurityUpdatesEnabled: null,
        enablementSource: probe.source,
        error: null,
        openAlerts: 0,
        openBySeverity: emptySeverityCounts(),
        fixedAlerts: 0,
        dismissedAlerts: 0,
      });
    }

    const byName = new Map(repos.map((r) => [r.fullName, r]));
    alerts = external;
    for (const a of alerts) {
      const repo = byName.get(a.repo);
      if (!repo) continue;
      if (a.state === 'open') {
        repo.openAlerts += 1;
        repo.openBySeverity[a.severity] += 1;
      } else if (a.state === 'fixed') repo.fixedAlerts += 1;
      else repo.dismissedAlerts += 1;
    }
    source = 'dependamate';
  } else {
    const collected = await client.collect(opts);
    repos = collected.repos;
    alerts = collected.alerts;
  }

  const snapshot: Snapshot = {
    schemaVersion: 1,
    meta: {
      date: opts.date ?? localDateString(),
      takenAt: new Date().toISOString(),
      viewer,
      source,
      toolVersion: TOOL_VERSION,
      reposScanned: repos.length,
      reposWithAlertsEnabled: repos.filter((r) => r.dependabotAlertsEnabled === true).length,
      reposSkipped: repos.filter((r) => r.error).length,
      durationMs: Date.now() - startedAt,
      errors: client.errors.slice(0, 200),
    },
    repos,
    alerts,
  };

  const file = writeSnapshot(snapshot);
  return {
    snapshot,
    file,
    openAlerts: alerts.filter((a) => a.state === 'open').length,
  };
}
