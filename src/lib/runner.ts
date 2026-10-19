/**
 * CLI entry point for a fetch (Node only): resolves a local token, optionally
 * runs an external scanner, collects, and overwrites the last-fetch file.
 */

import { collectSnapshot, CollectSnapshotOptions } from './collect';
import { runExternalScanner } from './dependamate';
import { GitHubClient } from './github';
import { writeSnapshot } from './store';
import { resolveToken } from './token';
import { Snapshot } from './types';

export interface RunOptions extends Omit<CollectSnapshotOptions, 'externalAlerts'> {
  /** Max 100-alert pages per repo. */
  maxAlertPages?: number;
  /** Shell command for an external scanner (e.g. DependaMate). */
  dependamate?: string;
  /** Explicit token; otherwise env vars then `gh auth token`. */
  token?: string;
}

export interface RunResult {
  snapshot: Snapshot;
  file: string;
  openAlerts: number;
}

export async function runSnapshot(opts: RunOptions = {}): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const client = new GitHubClient({
    token: resolveToken(opts.token),
    log,
    maxAlertPages: opts.maxAlertPages ?? 20,
  });

  let externalAlerts;
  if (opts.dependamate) {
    log(`running external scanner: ${opts.dependamate}`);
    externalAlerts = runExternalScanner(opts.dependamate);
    log(`external scanner returned ${externalAlerts.length} alerts`);
  }

  const snapshot = await collectSnapshot(client, { ...opts, externalAlerts });
  const file = writeSnapshot(snapshot);
  return {
    snapshot,
    file,
    openAlerts: snapshot.alerts.filter((a) => a.state === 'open').length,
  };
}
