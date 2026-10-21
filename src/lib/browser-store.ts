/**
 * Hosted-mode last-fetch store: one snapshot in this browser's IndexedDB.
 * Never leaves the device. Every call is best-effort — private windows or
 * blocked storage just mean the next visit starts empty.
 */

import { Snapshot } from './types';

const DB = 'dependash';
const STORE = 'snapshots';
const KEY = 'last-fetch';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** A stored fetch plus the account that was signed in when it was saved (null: signed out). */
export interface StoredSnapshot {
  snapshot: Snapshot;
  account: string | null;
}

function isSnapshot(value: unknown): value is Snapshot {
  const v = value as Snapshot | undefined;
  return !!v && Array.isArray(v.repos) && Array.isArray(v.alerts);
}

export async function loadBrowserSnapshot(): Promise<StoredSnapshot | null> {
  try {
    const value = await run<unknown>('readonly', (s) => s.get(KEY));
    const stored = value as Partial<StoredSnapshot> | undefined;
    if (stored && isSnapshot(stored.snapshot)) {
      return { snapshot: stored.snapshot, account: stored.account ?? null };
    }
    // Older entries were the bare snapshot; its viewer is the best guess at the account.
    return isSnapshot(value) ? { snapshot: value, account: value.meta.viewer } : null;
  } catch {
    return null;
  }
}

export async function saveBrowserSnapshot(snapshot: Snapshot, account: string | null): Promise<void> {
  try {
    const stored: StoredSnapshot = { snapshot, account };
    await run('readwrite', (s) => s.put(stored, KEY));
  } catch {
    /* storage unavailable — the dashboard still shows this fetch until reload */
  }
}

export async function clearBrowserSnapshot(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* nothing to clear */
  }
}
