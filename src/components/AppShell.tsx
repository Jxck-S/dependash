'use client';

/**
 * Chooses between the hosted-mode splash and the dashboard.
 *
 *  - hosted, signed out, nothing loaded → <Splash/> (sign in or try the demo)
 *  - hosted, signed out, demo loaded    → dashboard with a demo banner
 *  - signed in, or local mode           → dashboard with the fetch controls
 */

import Link from 'next/link';
import { Suspense } from 'react';
import NavTabs from './NavTabs';
import RunControls from './RunControls';
import Loading from './Loading';
import Splash from './Splash';
import { useData } from './DataProvider';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { auth, snapshot, ready, exitDemo } = useData();
  const signedOut = auth?.mode === 'hosted' && !auth.authenticated;

  if (ready && signedOut && !snapshot) return <Splash />;

  return (
    <div className="shell">
      <header className="topbar">
        <h1>
          <Link href="/" style={{ color: 'var(--text)' }}>
            dependash
          </Link>
        </h1>
        {/* Tabs wait for auth, so signed-out visitors don't see them flash before the splash. */}
        <Suspense fallback={<nav className="tabs" />}>
          {ready ? <NavTabs /> : <nav className="tabs" />}
        </Suspense>
      </header>
      {!ready ? (
        <Loading />
      ) : (
        <>
          {signedOut ? (
            <div className="demo-bar">
              <span>
                <span className="badge">demo</span> You’re exploring sample data — 14 fake repos, ~300
                alerts.
              </span>
              <a className="pg run-btn" href="/api/auth/login">
                Sign in with GitHub
              </a>
              <button className="pg" onClick={() => void exitDemo()}>
                Exit demo
              </button>
            </div>
          ) : (
            <RunControls />
          )}
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </>
      )}
    </div>
  );
}
