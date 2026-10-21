'use client';

/**
 * Header control strip: shows who we're authenticated as, when the data was
 * last fetched, and lets you pull fresh data without leaving the UI.
 *
 * The fetch runs right here in the browser: the shared collector walks every
 * repo through the same-origin /api/gh proxy (which attaches the token
 * server-side), then the result is saved and every page recomputes in place.
 * In hosted mode, signed-out visitors get a "Sign in with GitHub" button.
 */

import { useEffect, useRef, useState } from 'react';
import { collectSnapshot } from '@/lib/collect';
import { GitHubClient } from '@/lib/github';
import { useData } from './DataProvider';

interface RunResult {
  reposScanned: number;
  reposWithAlertsEnabled: number;
  openAlerts: number;
  durationMs: number;
  warnings: number;
}

export const AUTH_ERRORS: Record<string, string> = {
  access_denied: 'GitHub sign-in was cancelled.',
  invalid_state: 'Sign-in expired or was tampered with — please try again.',
  token_exchange_failed: 'GitHub didn’t accept the sign-in code — please try again.',
  profile_failed: 'Signed in, but couldn’t read your GitHub profile.',
};

const EXCLUDE_KEY = 'dependash:excludeOwners';

interface OwnerEntry {
  login: string;
  type: 'User' | 'Organization';
  repos: number | null;
}

/** Fetched owners plus any skipped ones that no longer show up (so they can be un-skipped). */
function pickerOwners(owners: OwnerEntry[], excluded: string[]): OwnerEntry[] {
  const known = new Set(owners.map((o) => o.login.toLowerCase()));
  const missing = excluded
    .filter((e) => !known.has(e.toLowerCase()))
    .map((login): OwnerEntry => ({ login, type: 'Organization', repos: null }));
  return [...owners, ...missing];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function RunControls() {
  const { auth, snapshot, saveSnapshot, signOut, refreshAuth } = useData();
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeForks, setIncludeForks] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [owners, setOwners] = useState<OwnerEntry[] | null>(null);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [showSkip, setShowSkip] = useState(false);
  const skipRef = useRef<HTMLDivElement>(null);

  const hosted = auth?.mode === 'hosted';
  const canFetch = Boolean(auth?.authenticated);

  // Surface a failed OAuth round-trip (?auth_error=…), then drop it from the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('auth_error');
    if (!code) return;
    setError(AUTH_ERRORS[code] ?? `Sign-in failed (${code}).`);
    setShowLog(true);
    url.searchParams.delete('auth_error');
    window.history.replaceState(null, '', url.toString());
  }, []);

  // Remember the skip list across reloads (per browser; best-effort).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(EXCLUDE_KEY) ?? '';
      setExcluded(saved.split(',').map((o) => o.trim()).filter(Boolean));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggleExcluded = (login: string) => {
    setExcluded((prev) => {
      const isSkipped = prev.some((o) => o.toLowerCase() === login.toLowerCase());
      const next = isSkipped
        ? prev.filter((o) => o.toLowerCase() !== login.toLowerCase())
        : [...prev, login];
      try {
        localStorage.setItem(EXCLUDE_KEY, next.join(','));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  // Load the owner list the first time the picker opens: the viewer's orgs
  // from GitHub, plus any other owner seen in the last fetch.
  useEffect(() => {
    if (!showSkip || owners) return;
    const found = new Map<string, OwnerEntry>();
    const viewer = auth?.viewer ?? snapshot?.meta.viewer ?? null;
    for (const r of snapshot?.repos ?? []) {
      const key = r.owner.toLowerCase();
      const entry = found.get(key) ?? {
        login: r.owner,
        type: r.ownerType ?? (key === viewer?.toLowerCase() ? 'User' : 'Organization'),
        repos: 0,
      };
      entry.repos = (entry.repos ?? 0) + 1;
      found.set(key, entry);
    }
    const finish = (err: string | null) => {
      // The viewer's own account first, then orgs, then other users.
      const rank = (o: OwnerEntry) =>
        viewer && o.login.toLowerCase() === viewer.toLowerCase() ? 0 : o.type === 'Organization' ? 1 : 2;
      setOwners([...found.values()].sort((a, b) => rank(a) - rank(b) || a.login.localeCompare(b.login)));
      setOwnersError(err);
    };
    if (!canFetch) {
      finish(null);
      return;
    }
    new GitHubClient({ baseUrl: '/api/gh' })
      .listOrgs()
      .then((orgs) => {
        for (const login of orgs) {
          const key = login.toLowerCase();
          if (!found.has(key)) found.set(key, { login, type: 'Organization', repos: null });
        }
        finish(null);
      })
      .catch((err: Error) => finish(err.message));
  }, [showSkip, owners, auth?.viewer, canFetch, snapshot]);

  // Close the picker on outside click.
  useEffect(() => {
    if (!showSkip) return;
    const onDown = (e: MouseEvent) => {
      if (skipRef.current && !skipRef.current.contains(e.target as Node)) setShowSkip(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showSkip]);

  const run = async () => {
    setRunning(true);
    setShowLog(true);
    setLogs([]);
    setError(null);
    setResult(null);
    const log = (line: string) => setLogs((prev) => [...prev, line].slice(-200));
    try {
      const client = new GitHubClient({ baseUrl: '/api/gh', log, maxAlertPages: 20 });
      const next = await collectSnapshot(client, {
        includeArchived,
        includeForks,
        excludeOwners: excluded,
        log,
      });
      await saveSnapshot(next);
      setResult({
        reposScanned: next.meta.reposScanned,
        reposWithAlertsEnabled: next.meta.reposWithAlertsEnabled,
        openAlerts: next.alerts.filter((a) => a.state === 'open').length,
        durationMs: next.meta.durationMs,
        warnings: next.meta.errors.length,
      });
      setOwners(null);
      void refreshAuth(); // updates the rate-limit counter
    } catch (err) {
      log(`failed: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const latest = snapshot?.meta;
  const latestOpen = snapshot?.alerts.filter((a) => a.state === 'open').length ?? 0;

  return (
    <div className="run-bar">
      {hosted && !auth?.authenticated ? (
        <a className="pg run-btn" href="/api/auth/login">
          Sign in with GitHub
        </a>
      ) : (
        <button className="pg run-btn" onClick={run} disabled={running || !canFetch}>
          {running ? <span className="spinner" /> : '⟳'} {running ? 'Fetching…' : 'Fetch now'}
        </button>
      )}

      <label className="opt" title="Archived repos are excluded by default">
        <input
          type="checkbox"
          checked={includeArchived}
          disabled={running}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        archived
      </label>
      <label className="opt" title="Forks are excluded by default">
        <input
          type="checkbox"
          checked={includeForks}
          disabled={running}
          onChange={(e) => setIncludeForks(e.target.checked)}
        />
        forks
      </label>
      <div className="skip-picker" ref={skipRef}>
        <button className="pg" disabled={running} onClick={() => setShowSkip((v) => !v)}>
          skip orgs{excluded.length ? ` (${excluded.length})` : ''} ▾
        </button>
        {showSkip && (
          <div className="skip-menu">
            {owners === null && <div className="muted">loading…</div>}
            {ownersError && <div className="muted" title={ownersError}>couldn’t load orgs from GitHub</div>}
            {pickerOwners(owners ?? [], excluded).map((o) => (
              <label key={o.login} className="opt">
                <input
                  type="checkbox"
                  checked={excluded.some((e) => e.toLowerCase() === o.login.toLowerCase())}
                  onChange={() => toggleExcluded(o.login)}
                />
                {o.login}
                <span className="muted">
                  {o.type === 'User' ? ' · user' : ''}
                  {o.repos != null ? ` · ${o.repos} repos` : ''}
                </span>
              </label>
            ))}
            {owners?.length === 0 && excluded.length === 0 && !ownersError && (
              <div className="muted">no orgs found</div>
            )}
          </div>
        )}
      </div>

      {latest ? (
        <span className="muted">
          Last fetched <strong>{relativeTime(latest.takenAt)}</strong> · {latest.reposScanned} repos ·{' '}
          {latestOpen} open
        </span>
      ) : (
        <span className="muted">
          {hosted && !auth?.authenticated ? 'Sign in to fetch your alerts.' : 'No data yet — click “Fetch now”.'}
        </span>
      )}

      <span className="run-auth">
        {auth === null && <span className="muted">checking auth…</span>}
        {auth?.authenticated && (
          <>
            <span className="badge on">{auth.viewer}</span>
            <span className="muted" title="read-only GET requests via the /api/gh proxy">
              via {auth.source === 'gh-cli' ? 'gh CLI token' : auth.detail}
              {auth.rateLimit ? ` · ${auth.rateLimit.remaining}/${auth.rateLimit.limit} API calls left` : ''}
            </span>
            {hosted && (
              <button className="pg" disabled={running} onClick={() => void signOut()}>
                Sign out
              </button>
            )}
          </>
        )}
        {auth && !auth.authenticated && !hosted && (
          <span className="badge off" title={auth.hint ?? auth.error ?? ''}>
            not authenticated
          </span>
        )}
      </span>

      {(logs.length > 0 || error) && (
        <button className="pg" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Hide log' : 'Show log'}
        </button>
      )}

      {showLog && (
        <div className="run-log">
          {error && <div style={{ color: 'var(--critical)' }}>✗ {error}</div>}
          {auth && !auth.authenticated && !hosted && (
            <div style={{ color: 'var(--medium)' }}>{auth.hint ?? auth.error}</div>
          )}
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {result && !running && (
            <div style={{ color: 'var(--good)' }}>
              ✓ {result.reposScanned} repos · {result.reposWithAlertsEnabled} with Dependabot ·{' '}
              {result.openAlerts} open alerts · {(result.durationMs / 1000).toFixed(1)}s
              {result.warnings ? ` · ${result.warnings} warnings` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
