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

export async function loadBrowserSnapshot(): Promise<Snapshot | null> {
  try {
    const value = await run<Snapshot | undefined>('readonly', (s) => s.get(KEY));
    return value && Array.isArray(value.repos) && Array.isArray(value.alerts) ? value : null;
  } catch {
    return null;
  }
}

export async function saveBrowserSnapshot(snapshot: Snapshot): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(snapshot, KEY));
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
