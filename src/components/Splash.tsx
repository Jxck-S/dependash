'use client';

/**
 * Hosted-mode landing page for signed-out visitors: what dependash is, real
 * screenshots of it (captured from the demo data), and the two ways in —
 * sign in with GitHub, or try the demo.
 */

import { useEffect, useState } from 'react';
import { buildDemoSnapshot } from '@/lib/demo';
import { useData } from './DataProvider';
import { AUTH_ERRORS } from './RunControls';

const REPO_URL = 'https://github.com/Jxck-S/dependash';

const SHOWCASE = [
  {
    eyebrow: 'Coverage',
    title: 'See which repos are protected — and which aren’t',
    body: 'Every repo your account can reach, side by side, with Dependabot status, severity breakdown, risk and health scores.',
    points: [
      'Dependabot on, off or unknown for every repo',
      'Private, fork and archived badges across owners',
      'Risk score weighted by severity and how long alerts sit',
    ],
    image: '/screens/repos.webp',
    height: 1126,
    alt: 'Repositories view: every repo with Dependabot status, alert counts, risk and health scores',
  },
  {
    eyebrow: 'History',
    title: 'Months of trends from a single fetch',
    body: 'GitHub already stamps when every alert was opened, fixed or dismissed. dependash rebuilds the timeline from those — no database, no cron job, no waiting weeks for data points.',
    points: [
      'Open alerts over time, by severity',
      'MTTR per severity and fix velocity',
      'Churn: alerts created vs fixed each day',
    ],
    image: '/screens/trends.webp',
    height: 1108,
    alt: 'Trends view: MTTR by severity and open alerts over time',
  },
  {
    eyebrow: 'Triage',
    title: 'Know what to fix first',
    body: 'Alert aging shows what has been sitting too long; the alert table sorts by risk and links straight to each alert and advisory on GitHub.',
    points: [
      'Search by repo, package, GHSA or CVE',
      'Filter by severity and ecosystem',
      'Scope any view to one owner, personal repos or orgs',
    ],
    image: '/screens/alerts.webp',
    height: 1126,
    alt: 'Alerts view: alert aging chart and the table of open alerts with advisories',
  },
];

const STEPS = [
  {
    title: 'Sign in with GitHub',
    body: 'Standard GitHub OAuth. Approve any orgs you want included on the consent screen.',
  },
  {
    title: 'Fetch',
    body: 'Your browser walks every repo you can reach through a read-only proxy. Seconds for most accounts.',
  },
  {
    title: 'Triage',
    body: 'Every metric is computed right in your browser. Fetch again whenever you want fresh data.',
  },
];

const SECURITY = [
  {
    title: 'Read-only by design',
    body: 'The server only forwards GET requests, and only to the handful of GitHub endpoints dependash needs.',
  },
  {
    title: 'Your token stays sealed',
    body: 'It lives in an encrypted, HttpOnly cookie. Page JavaScript can never read it.',
  },
  {
    title: 'Your data stays with you',
    body: 'Alert data is stored in your own browser. There is no database — nothing to leak.',
  },
  {
    title: 'Open source',
    body: 'Read every line on GitHub, or run it locally against your gh CLI token instead.',
  },
];

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function BrowserFrame({
  src,
  alt,
  width = 1800,
  height,
  eager,
}: {
  src: string;
  alt: string;
  width?: number;
  height: number;
  eager?: boolean;
}) {
  return (
    <figure className="frame">
      <div className="frame-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <div className="frame-url">dependash.vercel.app</div>
      </div>
      <img src={src} alt={alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} />
    </figure>
  );
}

export default function Splash() {
  const { saveSnapshot } = useData();
  const [error, setError] = useState<string | null>(null);

  // A failed OAuth round-trip lands back here (?auth_error=…); show it, then drop it from the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('auth_error');
    if (!code) return;
    setError(AUTH_ERRORS[code] ?? `Sign-in failed (${code}).`);
    url.searchParams.delete('auth_error');
    window.history.replaceState(null, '', url.toString());
  }, []);

  const tryDemo = () => {
    window.scrollTo(0, 0);
    saveSnapshot(buildDemoSnapshot()).catch((err: Error) => setError(err.message));
  };

  const ctas = (
    <div className="lp-cta">
      <a className="lp-btn primary" href="/api/auth/login">
        <GitHubMark /> Sign in with GitHub
      </a>
      <button className="lp-btn" onClick={tryDemo}>
        Try the live demo →
      </button>
    </div>
  );

  return (
    <div className="lp">
      <nav className="lp-nav">
        <a className="lp-brand" href="#top">
          <img src="/icon.svg" alt="" width={28} height={28} />
          dependash
        </a>
        <div className="lp-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#security">Security</a>
          <a href={REPO_URL}>GitHub</a>
        </div>
        <a className="lp-btn primary small" href="/api/auth/login">
          Sign in
        </a>
      </nav>

      <header className="lp-hero" id="top">
        <div className="lp-pill">Free &amp; open source · read-only · no database</div>
        <h1>
          Every Dependabot alert.
          <br />
          Every account. <span className="lp-grad">One dashboard.</span>
        </h1>
        <p className="lp-lead">
          GitHub shows Dependabot alerts one repo at a time. dependash pulls every personal, org and
          collaborator repo you can reach into a single triage-ready view — with history, MTTR and risk
          scores from one fetch.
        </p>
        {ctas}
        {error && <p className="lp-error">{error}</p>}
        <p className="lp-fine">No install · Nothing stored on our servers · Sign out wipes your data</p>
        <div className="lp-hero-shot">
          <BrowserFrame
            src="/screens/overview.webp"
            alt="dependash overview dashboard"
            width={2200}
            height={1375}
            eager
          />
        </div>
      </header>

      <section className="lp-strip">
        <div>
          <strong>1 fetch</strong>
          <span>months of history</span>
        </div>
        <div>
          <strong>Every owner</strong>
          <span>personal, orgs, collaborators</span>
        </div>
        <div>
          <strong>100% GET</strong>
          <span>nothing written to GitHub</span>
        </div>
        <div>
          <strong>0 databases</strong>
          <span>your data stays in your browser</span>
        </div>
      </section>

      <section className="lp-section" id="features">
        {SHOWCASE.map((s, i) => (
          <div key={s.title} className={`lp-feature${i % 2 ? ' flip' : ''}`}>
            <div className="lp-feature-text">
              <div className="lp-eyebrow">{s.eyebrow}</div>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
              <ul>
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <BrowserFrame src={s.image} alt={s.alt} height={s.height} />
          </div>
        ))}
      </section>

      <section className="lp-section" id="how">
        <div className="lp-center">
          <div className="lp-eyebrow">How it works</div>
          <h2>From sign-in to a full picture in under a minute</h2>
        </div>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="lp-step-n">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section" id="security">
        <div className="lp-center">
          <div className="lp-eyebrow">Security</div>
          <h2>Built to be trusted with your alerts</h2>
        </div>
        <div className="lp-cards">
          {SECURITY.map((s) => (
            <div key={s.title} className="lp-card">
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
        <p className="lp-note">
          GitHub only grants access to private-repo alerts through the broad <code>repo</code> OAuth scope.
          dependash uses it to read — the proxy rejects anything that isn’t a GET to an allowlisted endpoint.
        </p>
      </section>

      <section className="lp-final">
        <h2>See your whole Dependabot picture</h2>
        <p>Sign in and fetch — or look around with sample data first.</p>
        {ctas}
      </section>

      <footer className="lp-foot">
        <span className="lp-brand">
          <img src="/icon.svg" alt="" width={20} height={20} />
          dependash
        </span>
        <span>
          MIT licensed · <a href={REPO_URL}>Source on GitHub</a> · Not affiliated with GitHub
        </span>
      </footer>
    </div>
  );
}
