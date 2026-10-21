'use client';

/**
 * Holds the app mode, auth status and the last fetch for every page.
 *
 *  - local mode:  the last fetch is the server's file (shared with
 *                 `npm run snapshot` / `npm run demo`), via /api/snapshot.
 *  - hosted mode: the last fetch lives in this browser's IndexedDB only.
 *
 * Pages call useDashboard(), which applies the ?scope= owner filter and runs
 * the aggregation engine client-side.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { clearBrowserSnapshot, loadBrowserSnapshot, saveBrowserSnapshot } from '@/lib/browser-store';
import { getDashboardData, resolveScope } from '@/lib/data';
import { DashboardData, Snapshot } from '@/lib/types';

export type AppMode = 'local' | 'hosted';

export interface AuthInfo {
  mode: AppMode;
  authenticated: boolean;
  viewer?: string;
  source: string;
  detail: string;
  rateLimit?: { remaining: number; limit: number };
  hint?: string;
  error?: string;
}

interface DataState {
  auth: AuthInfo | null;
  snapshot: Snapshot | null;
  /** True once auth and the stored fetch have both been loaded. */
  ready: boolean;
  saveSnapshot: (snapshot: Snapshot) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);

async function fetchAuth(): Promise<AuthInfo | null> {
  try {
    const res = await fetch('/api/auth', { cache: 'no-store' });
    return (await res.json()) as AuthInfo;
  } catch {
    return null;
  }
}

async function loadSnapshot(auth: AuthInfo | null): Promise<Snapshot | null> {
  if (auth?.mode === 'local') {
    const res = await fetch('/api/snapshot', { cache: 'no-store' }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { snapshot?: Snapshot | null } | null;
    return body?.snapshot ?? null;
  }
  const stored = await loadBrowserSnapshot();
  // Only show what was saved under the current sign-in state: one GitHub
  // account's data never reaches another on a shared browser, and demo data
  // loaded while signed out doesn't linger after signing in.
  if (!stored || stored.account !== currentAccount(auth)) return null;
  return stored.snapshot;
}

/** The signed-in GitHub login in hosted mode, or null when signed out. */
function currentAccount(auth: AuthInfo | null): string | null {
  return auth?.authenticated ? auth.viewer ?? null : null;
}

export default function DataProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const a = await fetchAuth();
      setAuth(a);
      setSnapshot(await loadSnapshot(a));
      setReady(true);
    })();
  }, []);

  const refreshAuth = useCallback(async () => {
    setAuth(await fetchAuth());
  }, []);

  const saveSnapshot = useCallback(
    async (next: Snapshot) => {
      setSnapshot(next);
      if (auth?.mode === 'local') {
        const res = await fetch('/api/snapshot', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(`couldn’t save the fetch: ${body.error}`);
        }
      } else {
        await saveBrowserSnapshot(next, currentAccount(auth));
      }
    },
    [auth],
  );

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    await clearBrowserSnapshot();
    setSnapshot(null);
    setAuth(await fetchAuth());
  }, []);

  const value = useMemo(
    () => ({ auth, snapshot, ready, saveSnapshot, signOut, refreshAuth }),
    [auth, snapshot, ready, saveSnapshot, signOut, refreshAuth],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData() must be used inside <DataProvider>');
  return ctx;
}

/** Dashboard metrics for the current ?scope=, or null until data has loaded. */
export function useDashboard(): DashboardData | null {
  const { snapshot, ready } = useData();
  const scope = resolveScope(useSearchParams().get('scope'));
  return useMemo(() => (ready ? getDashboardData(snapshot, scope) : null), [ready, snapshot, scope]);
}
