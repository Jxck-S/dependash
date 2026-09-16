/**
 * Run-state store for UI-triggered snapshots.
 *
 * Why this isn't just a module-level variable: writing a snapshot into
 * files inside the project can trigger the dev server's file watcher, which re-evaluates
 * route modules and would wipe in-memory progress. State is therefore kept on
 * `globalThis` (survives HMR module re-evaluation) *and* mirrored to a file in
 * the OS temp dir (survives a full worker restart, and lives outside the
 * watched project tree so it can't trigger further reloads).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RunResultSummary {
  date: string;
  file: string;
  reposScanned: number;
  reposWithAlertsEnabled: number;
  openAlerts: number;
  durationMs: number;
  warnings: number;
}

export interface RunState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  logs: string[];
  error: string | null;
  result: RunResultSummary | null;
  /** Identifies the process that owns an in-flight run. */
  pid: number | null;
}

const EMPTY: RunState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  logs: [],
  error: null,
  result: null,
  pid: null,
};

const stateFile = path.join(os.tmpdir(), 'dependash-run-state.json');

const globalRef = globalThis as unknown as { __dependaRunState?: RunState };

function fromDisk(): RunState | null {
  try {
    if (!fs.existsSync(stateFile)) return null;
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as RunState;
  } catch {
    return null;
  }
}

export function getRunState(): RunState {
  const state = globalRef.__dependaRunState ?? fromDisk() ?? { ...EMPTY };

  // If the process that owned an in-flight run is gone, don't report it as
  // running forever.
  if (state.running && state.pid !== null && state.pid !== process.pid) {
    try {
      process.kill(state.pid, 0);
    } catch {
      state.running = false;
      state.error = state.error ?? 'The process running this snapshot exited.';
      state.finishedAt = state.finishedAt ?? new Date().toISOString();
    }
  }

  globalRef.__dependaRunState = state;
  return state;
}

export function setRunState(patch: Partial<RunState>): RunState {
  const next = { ...getRunState(), ...patch };
  globalRef.__dependaRunState = next;
  try {
    fs.writeFileSync(stateFile, JSON.stringify(next), 'utf8');
  } catch {
    /* temp dir unavailable — in-memory state still works */
  }
  return next;
}

export function appendLog(line: string): void {
  const state = getRunState();
  const logs = [...state.logs, line].slice(-200);
  setRunState({ logs });
}
