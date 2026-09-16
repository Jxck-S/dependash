/**
 * Last-fetch store.
 *
 * dependash keeps exactly **one** fetch: the most recent one. It is written to
 * a single JSON file in the OS temp directory, so it survives a dev-server
 * restart but is never treated as a long-term archive and never lands in your
 * repo.
 *
 * Trends are NOT built by diffing multiple files — they are reconstructed from
 * the `createdAt` / `fixedAt` / `dismissedAt` timestamps GitHub returns inside
 * this single fetch. See metrics.ts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Snapshot } from './types';

/** Directory holding the single last-fetch file. */
export function stateDir(): string {
  return process.env.DEPENDASH_STATE_DIR ?? path.join(os.tmpdir(), 'dependash');
}

/** Absolute path of the one and only data file. */
export function snapshotFile(): string {
  return path.join(stateDir(), 'last-fetch.json');
}

export function localDateString(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Read the last fetch, or null if nothing has been collected yet. */
export function readSnapshot(file = snapshotFile()): Snapshot | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
    if (!parsed || !Array.isArray(parsed.repos) || !Array.isArray(parsed.alerts)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Overwrite the last fetch. Written atomically so a crash can't truncate it. */
export function writeSnapshot(snapshot: Snapshot, file = snapshotFile()): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

export function clearSnapshot(file = snapshotFile()): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* nothing to clear */
  }
}

/** When the last fetch happened, or null if there isn't one. */
export function lastFetchedAt(file = snapshotFile()): string | null {
  return readSnapshot(file)?.meta.takenAt ?? null;
}
