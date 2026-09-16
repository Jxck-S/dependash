/**
 * Local-only control endpoints for running a fetch from the UI.
 *
 * Safety properties:
 *  - Refuses any request that did not come from this machine (loopback only).
 *  - Only ever triggers the read-only collector; GitHub sees GET requests only.
 *  - Serialized: one run at a time, tracked in module state.
 *  - The external-scanner option is NOT exposed here (no arbitrary shell from
 *    the browser); use the CLI flag for that.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runSnapshot } from '@/lib/collect';
import { readSnapshot } from '@/lib/store';
import { appendLog, getRunState, setRunState } from '@/lib/runstate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only allow requests originating from this machine. */
function isLocal(req: NextRequest): boolean {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const allowed = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];
  if (allowed.includes(host)) return true;
  // Allow an explicit opt-in when self-hosting behind your own auth.
  return process.env.DEPENDASH_ALLOW_REMOTE_RUN === '1';
}

function lastFetchInfo() {
  const latest = readSnapshot();
  if (!latest) return null;
  return {
    date: latest.meta.date,
    takenAt: latest.meta.takenAt,
    viewer: latest.meta.viewer,
    reposScanned: latest.meta.reposScanned,
    reposWithAlertsEnabled: latest.meta.reposWithAlertsEnabled,
    openAlerts: latest.alerts.filter((a) => a.state === 'open').length,
  };
}

/** Poll target: current run status + last-fetch metadata. */
export async function GET(req: NextRequest) {
  if (!isLocal(req)) {
    return NextResponse.json({ error: 'Local requests only.' }, { status: 403 });
  }
  const state = getRunState();
  return NextResponse.json({
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    logs: state.logs.slice(-40),
    error: state.error,
    result: state.result,
    latest: lastFetchInfo(),
  });
}

/** Start a snapshot run. Returns immediately; poll GET for progress. */
export async function POST(req: NextRequest) {
  if (!isLocal(req)) {
    return NextResponse.json({ error: 'Local requests only.' }, { status: 403 });
  }
  if (getRunState().running) {
    return NextResponse.json(
      { error: 'A snapshot is already running.', running: true },
      { status: 409 },
    );
  }

  let body: { owners?: string[]; includeArchived?: boolean; includeForks?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  const startedAt = new Date().toISOString();
  setRunState({
    running: true,
    startedAt,
    finishedAt: null,
    logs: [],
    error: null,
    result: null,
    pid: process.pid,
  });

  // Fire and forget; the client polls GET for progress.
  void runSnapshot({
    owners: body.owners,
    includeArchived: body.includeArchived,
    includeForks: body.includeForks,
    log: (msg) => appendLog(msg),
  })
    .then(({ snapshot, file, openAlerts }) => {
      appendLog(`snapshot written: ${file}`);
      setRunState({
        result: {
          date: snapshot.meta.date,
          file,
          reposScanned: snapshot.meta.reposScanned,
          reposWithAlertsEnabled: snapshot.meta.reposWithAlertsEnabled,
          openAlerts,
          durationMs: snapshot.meta.durationMs,
          warnings: snapshot.meta.errors.length,
        },
      });
    })
    .catch((err: Error) => {
      appendLog(`failed: ${err.message}`);
      setRunState({ error: err.message });
    })
    .finally(() => {
      setRunState({ running: false, finishedAt: new Date().toISOString(), pid: null });
    });

  return NextResponse.json({ started: true, startedAt });
}
