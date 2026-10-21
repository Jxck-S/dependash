'use client';

import { useState } from 'react';
import { buildDemoSnapshot } from '@/lib/demo';
import { useData } from './DataProvider';

export default function EmptyState() {
  const { auth, saveSnapshot } = useData();
  const [error, setError] = useState<string | null>(null);
  const hosted = auth?.mode === 'hosted';
  const signedOut = hosted && !auth?.authenticated;

  const loadDemo = () => {
    saveSnapshot(buildDemoSnapshot()).catch((err: Error) => setError(err.message));
  };

  return (
    <div className="panel empty">
      <h2 style={{ textTransform: 'none', fontSize: 18, color: 'var(--text)' }}>
        {signedOut ? 'Every Dependabot alert you can see, in one place' : 'No data yet'}
      </h2>
      {signedOut ? (
        <>
          <p>
            Sign in with GitHub and dependash walks every repository your account can reach —
            personal, org and collaborator repos — and builds one dashboard from their Dependabot alerts.
          </p>
          <p>
            <a className="pg run-btn" href="/api/auth/login">Sign in with GitHub</a>
          </p>
          <p className="muted">
            Read-only: every GitHub API call is a GET. Your alert data is stored only in this browser,
            never on the server.
          </p>
        </>
      ) : (
        <>
          <p>
            Click <strong>Fetch now</strong> above
            {hosted ? '.' : ', or run the collector from a terminal:'}
          </p>
          {!hosted && (
            <>
              <p className="mono">npm run snapshot</p>
              <p className="muted">
                It authenticates with <code>gh auth token</code> (or <code>$GITHUB_TOKEN</code>), makes
                read-only GitHub API calls, and keeps only the most recent result. Nothing is ever written
                back to GitHub.
              </p>
            </>
          )}
        </>
      )}
      <p>
        <button className="pg" onClick={loadDemo}>
          Load demo data
        </button>{' '}
        <span className="muted">14 fake repos, ~300 alerts — replaced by your next fetch.</span>
      </p>
      {error && <p style={{ color: 'var(--critical)' }}>{error}</p>}
    </div>
  );
}
