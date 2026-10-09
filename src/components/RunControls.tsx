'use client';

/**
 * Header control strip: shows who we're authenticated as, when the data was
 * last fetched, and lets you pull fresh data without leaving the UI.
 *
 * While a run is in progress it polls /api/snapshot for log lines, then calls
 * router.refresh() so the server components re-read the last fetch and every metric
 * updates in place.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AuthInfo {
  authenticated: boolean;
  viewer?: string;
  source: string;
  detail: string;
  transport?: string;
  rateLimit?: { remaining: number; limit: number };
  hint?: string;
  error?: string;
}

interface RunStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  logs: string[];
  error: string | null;
  result: {
    date: string;
    reposScanned: number;
    reposWithAlertsEnabled: number;
    openAlerts: number;
    durationMs: number;
    warnings: number;
  } | null;
  latest: {
    date: string;
    takenAt: string;
    viewer: string;
    reposScanned: number;
    openAlerts: number;
  } | null;
}

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
  const router = useRouter();
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [starting, setStarting] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeForks, setIncludeForks] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [owners, setOwners] = useState<OwnerEntry[] | null>(null);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [showSkip, setShowSkip] = useState(false);
  const skipRef = useRef<HTMLDivElement>(null);
  const wasRunning = useRef(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch('/api/snapshot', { cache: 'no-store' });
    const data: RunStatus = await res.json();
    setStatus(data);
    // A run just finished — pull the new numbers into the page.
    if (wasRunning.current && !data.running) {
      router.refresh();
      setStarting(false);
    }
    wasRunning.current = data.running;
    return data;
  }, [router]);

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

  // Load the owner list the first time the picker opens.
  useEffect(() => {
    if (!showSkip || owners) return;
    fetch('/api/owners', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { owners: OwnerEntry[]; error: string | null }) => {
        setOwners(data.owners ?? []);
        setOwnersError(data.error);
      })
      .catch((err: Error) => {
        setOwners([]);
        setOwnersError(err.message);
      });
  }, [showSkip, owners]);

  // Close the picker on outside click.
  useEffect(() => {
    if (!showSkip) return;
    const onDown = (e: MouseEvent) => {
      if (skipRef.current && !skipRef.current.contains(e.target as Node)) setShowSkip(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showSkip]);

  useEffect(() => {
    fetch('/api/auth', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setAuth)
      .catch(() => setAuth(null));
    void loadStatus();
  }, [loadStatus]);

  // Poll while a fetch is running.
  useEffect(() => {
    if (!status?.running && !starting) return;
    const id = setInterval(() => void loadStatus(), 1200);
    return () => clearInterval(id);
  }, [status?.running, starting, loadStatus]);

  const run = async () => {
    setStarting(true);
    setShowLog(true);
    wasRunning.current = true;
    const res = await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        includeArchived,
        includeForks,
        excludeOwners: excluded,
      }),
    });
    if (!res.ok) {
      setStarting(false);
      const body = await res.json().catch(() => ({ error: 'Failed to start' }));
      setStatus((s) => (s ? { ...s, error: body.error } : s));
      return;
    }
    void loadStatus();
  };

  const running = Boolean(status?.running) || starting;
  const latest = status?.latest;
  const logs = status?.logs ?? [];

  return (
    <div className="run-bar">
      <button className="pg run-btn" onClick={run} disabled={running || auth?.authenticated === false}>
        {running ? <span className="spinner" /> : '⟳'} {running ? 'Fetching…' : 'Fetch now'}
      </button>

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
          {latest.openAlerts} open
        </span>
      ) : (
        <span className="muted">No data yet — click “Fetch now”.</span>
      )}

      <span className="run-auth">
        {auth === null && <span className="muted">checking auth…</span>}
        {auth?.authenticated && (
          <>
            <span className="badge on">{auth.viewer}</span>
            <span className="muted" title={auth.transport}>
              via {auth.source === 'gh-cli' ? 'gh CLI token' : auth.detail}
              {auth.rateLimit ? ` · ${auth.rateLimit.remaining}/${auth.rateLimit.limit} API calls left` : ''}
            </span>
          </>
        )}
        {auth && !auth.authenticated && (
          <span className="badge off" title={auth.hint ?? auth.error ?? ''}>
            not authenticated
          </span>
        )}
      </span>

      {(logs.length > 0 || status?.error) && (
        <button className="pg" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Hide log' : 'Show log'}
        </button>
      )}

      {showLog && (
        <div className="run-log">
          {status?.error && <div style={{ color: 'var(--critical)' }}>✗ {status.error}</div>}
          {auth && !auth.authenticated && (
            <div style={{ color: 'var(--medium)' }}>{auth.hint ?? auth.error}</div>
          )}
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {status?.result && !status.running && (
            <div style={{ color: 'var(--good)' }}>
              ✓ {status.result.reposScanned} repos ·{' '}
              {status.result.reposWithAlertsEnabled} with Dependabot · {status.result.openAlerts} open
              alerts · {(status.result.durationMs / 1000).toFixed(1)}s
              {status.result.warnings ? ` · ${status.result.warnings} warnings` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
