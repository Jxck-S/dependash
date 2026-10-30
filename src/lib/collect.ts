/**
 * Shared collection logic.
 *
 * Both entry points use this single implementation:
 *   - the CLI runner  (scripts/snapshot.ts, via runner.ts)
 *   - the UI button   (RunControls, in the browser, through the /api/gh proxy)
 *
 * Pure: no fs, no child processes, so it bundles for the browser. Still
 * read-only toward GitHub: it delegates to GitHubClient, which issues GET
 * requests exclusively.
 */

import { GitHubClient, CollectOptions } from './github';
import { AlertRecord, RepoRecord, Snapshot, emptySeverityCounts, localDateString } from './types';

export const TOOL_VERSION = 'dependash@1.0.0';

export interface CollectSnapshotOptions extends CollectOptions {
  /** Override the snapshot date. */
  date?: string;
  /** Alerts from an external scanner (e.g. DependaMate) instead of the API. */
  externalAlerts?: AlertRecord[];
  log?: (msg: string) => void;
}

/** Walk every visible repo and build a snapshot. Writes nothing. */
export async function collectSnapshot(
  client: GitHubClient,
  opts: CollectSnapshotOptions = {},
): Promise<Snapshot> {
  const startedAt = Date.now();
  const log = opts.log ?? (() => {});
  opts.onProgress?.({ phase: 'auth', done: 0, total: 0, alerts: 0 });

  const viewer = await client.viewer();
  const rl = await client.rateLimit();
  log(`authenticated as ${viewer} (core rate limit: ${rl.remaining}/${rl.limit})`);

  let repos: RepoRecord[];
  let alerts: AlertRecord[];
  let source: Snapshot['meta']['source'] = 'github-api';

  if (opts.externalAlerts) {
    const external = opts.externalAlerts;
    opts.onProgress?.({ phase: 'listing', done: 0, total: 0, alerts: 0 });
    const rawRepos = await client.listRepos(opts);
    repos = [];
    for (const raw of rawRepos) {
      opts.onProgress?.({
        phase: 'scanning',
        done: repos.length,
        total: rawRepos.length,
        alerts: 0,
        current: raw.full_name,
      });
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
    // Drop external alerts for repos that were filtered out (e.g. excluded owners).
    alerts = external.filter((a) => byName.has(a.repo));
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

  return {
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
}
