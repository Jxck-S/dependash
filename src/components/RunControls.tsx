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
      body: JSON.stringify({ includeArchived, includeForks }),
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
