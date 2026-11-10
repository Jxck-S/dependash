#!/usr/bin/env tsx
/**
 * Dependency-free self-test for the aggregation engine and the hosted-mode
 * session cookie.
 *
 *   npx tsx scripts/selftest.ts
 *
 * Builds a synthetic fetch in memory, runs the real metric code and asserts the
 * trend / MTTR / churn numbers. Touches nothing on GitHub and writes no files.
 */

import assert from 'node:assert/strict';
import {
  computeDashboardData,
  buildLifecycles,
  buildDailySeries,
  TREND_WINDOW_DAYS,
} from '../src/lib/metrics';
import { applyScope, buildOwnerOptions, normalizeScope } from '../src/lib/scope';
import { AlertRecord, RepoRecord, Snapshot, emptySeverityCounts } from '../src/lib/types';
import { buildDemoSnapshot } from '../src/lib/demo';
import { sealSession, unsealSession } from '../src/lib/session';
import { agentFixPrompt, alertsMarkdown, groupByRepo, repoNames } from '../src/lib/alert-export';
import { bumpFor, classify, compareVersions, matchPr, reachesPatch, summarizeCi, triageRepo } from '../src/lib/fixes';
import type { GitHubClient } from '../src/lib/github';
import { sealTyped, unsealTyped } from '../src/lib/session';
import { pkceMatches, registerClient, validRedirectUri } from '../src/lib/mcp/oauth';
import { handleMessage } from '../src/lib/mcp/server';
import crypto from 'node:crypto';

function iso(date: string): string {
  return `${date}T12:00:00Z`;
}

/** YYYY-MM-DD n days before today, for window-sensitive assertions. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function alert(
  repo: string,
  number: number,
  overrides: Partial<AlertRecord> = {},
): AlertRecord {
  return {
    key: `${repo}#${number}`,
    repo,
    number,
    state: 'open',
    severity: 'high',
    ghsaId: `GHSA-test-${number}`,
    cveId: null,
    summary: 'test advisory',
    cvssScore: 7.5,
    ecosystem: 'npm',
    packageName: `pkg-${number}`,
    manifestPath: 'package.json',
    vulnerableVersionRange: '< 1.0.0',
    firstPatchedVersion: '1.0.0',
    scope: 'runtime',
    createdAt: iso('2026-01-01'),
    updatedAt: iso('2026-01-01'),
    fixedAt: null,
    dismissedAt: null,
    dismissedReason: null,
    htmlUrl: `https://github.com/${repo}/security/dependabot/${number}`,
    advisoryUrl: `https://github.com/advisories/GHSA-test-${number}`,
    ...overrides,
  };
}

function repo(fullName: string, alerts: AlertRecord[]): RepoRecord {
  const open = alerts.filter((a) => a.repo === fullName && a.state === 'open');
  const bySeverity = emptySeverityCounts();
  for (const a of open) bySeverity[a.severity] += 1;
  const [owner, name] = fullName.split('/');
  return {
    fullName,
    owner,
    ownerType: owner === 'acme' ? 'Organization' : 'User',
    name,
    private: false,
    archived: false,
    fork: false,
    disabled: false,
    defaultBranch: 'main',
    language: 'TypeScript',
    stars: 0,
    pushedAt: iso('2026-01-01'),
    htmlUrl: `https://github.com/${fullName}`,
    dependabotUrl: `https://github.com/${fullName}/security/dependabot`,
    dependabotAlertsEnabled: true,
    dependabotSecurityUpdatesEnabled: null,
    enablementSource: 'alerts-api-ok',
    error: null,
    openAlerts: open.length,
    openBySeverity: bySeverity,
    fixedAlerts: alerts.filter((a) => a.repo === fullName && a.state === 'fixed').length,
    dismissedAlerts: 0,
  };
}

function snapshot(date: string, alerts: AlertRecord[], repos: string[]): Snapshot {
  return {
    schemaVersion: 1,
    meta: {
      date,
      takenAt: iso(date),
      viewer: 'tester',
      source: 'github-api',
      toolVersion: 'selftest',
      reposScanned: repos.length,
      reposWithAlertsEnabled: repos.length,
      reposSkipped: 0,
      durationMs: 1,
      errors: [],
    },
    repos: repos.map((r) => repo(r, alerts)),
    alerts,
  };
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('metrics engine self-test\n');

/* 1. Lifecycle reconstruction */
const a1 = alert('acme/app', 1, { createdAt: iso('2026-01-10') });
const a2 = alert('acme/app', 2, {
  severity: 'critical',
  createdAt: iso('2026-01-10'),
  state: 'fixed',
  fixedAt: iso('2026-01-20'),
});
const lifecycles = buildLifecycles(snapshot('2026-01-25', [a1, a2], ['acme/app']));

check('one lifecycle per alert', () => assert.equal(lifecycles.length, 2));
check('fixed alert records a 10-day remediation', () => {
  const lc = lifecycles.find((l) => l.key === 'acme/app#2')!;
  assert.equal(lc.closedState, 'fixed');
  assert.equal(lc.ageDays, 10);
});
check('open alert has no closing date', () => {
  const lc = lifecycles.find((l) => l.key === 'acme/app#1')!;
  assert.equal(lc.closedAt, null);
  assert.equal(lc.resolved, false);
});

/* 2. Daily series reconstruction */
const daily = buildDailySeries(snapshot('2026-01-25', [a1, a2], ['acme/app']), lifecycles);
check('series covers the alert creation day', () => {
  const day = daily.find((d) => d.date === '2026-01-10')!;
  assert.equal(day.newAlerts, 2);
  assert.equal(day.openAlerts, 2);
});
check('open count drops on the fix date', () => {
  const day = daily.find((d) => d.date === '2026-01-20')!;
  assert.equal(day.fixedAlerts, 1);
  assert.equal(day.openAlerts, 1);
  assert.equal(day.netChange, -1);
});
check('series runs from the first alert up to today', () => {
  assert.equal(daily[0].date, '2026-01-10');
  assert.equal(daily[daily.length - 1].date, daysAgo(0));
});

/* 3. Dismissed alerts close the lifecycle without counting as a fix */
const dismissed = buildLifecycles(
  snapshot('2026-02-02', [
    alert('acme/app', 9, {
      createdAt: iso('2026-02-01'),
      state: 'dismissed',
      dismissedAt: iso('2026-02-02'),
    }),
  ], ['acme/app']),
);
check('dismissed alert closes but is not counted as fixed', () => {
  assert.equal(dismissed.length, 1);
  assert.equal(dismissed[0].closedState, 'dismissed');
  assert.equal(dismissed[0].closedAt, '2026-02-02');
  assert.equal(dismissed[0].resolved, true);
});

/* 4. End-to-end aggregation, risk scoring and repo trends */
const day1 = snapshot(
  '2026-03-01',
  [
    alert('acme/app', 1, { severity: 'critical', createdAt: iso('2026-03-01') }),
    alert('acme/app', 2, { severity: 'low', createdAt: iso('2026-03-01') }),
    alert('acme/lib', 3, { severity: 'medium', createdAt: iso('2026-03-01') }),
  ],
  ['acme/app', 'acme/lib'],
);
const day2 = snapshot(
  '2026-03-02',
  [
    alert('acme/app', 1, {
      severity: 'critical',
      createdAt: iso('2026-03-01'),
      state: 'fixed',
      fixedAt: iso('2026-03-02'),
    }),
    alert('acme/app', 2, { severity: 'low', createdAt: iso('2026-03-01') }),
    alert('acme/lib', 3, { severity: 'medium', createdAt: iso('2026-03-01') }),
    alert('acme/lib', 4, { severity: 'high', createdAt: iso('2026-03-02') }),
  ],
  ['acme/app', 'acme/lib'],
);
const data = computeDashboardData(day2);

check('totals reflect the current fetch', () => {
  assert.equal(data.totals.openAlerts, 3);
  assert.equal(data.totals.bySeverity.high, 1);
  assert.equal(data.totals.bySeverity.critical, 0);
});
check('MTTR counts the 1-day critical fix', () => assert.equal(data.totals.mttrDays, 1));
check('alerts outside the trend window produce no delta', () => {
  // day2's alerts are from 2026-03, far outside the trailing window.
  assert.deepEqual(data.increasing, []);
  assert.deepEqual(data.decreasing, []);
});
check('risk score is severity-weighted and aging-amplified', () => {
  // acme/lib = medium(2) + high(5) = 7 base, x1..x2 depending on alert age.
  const lib = data.repos.find((r) => r.fullName === 'acme/lib')!;
  assert.ok(lib.riskScore >= 7 && lib.riskScore <= 14, `got ${lib.riskScore}`);
  const app = data.repos.find((r) => r.fullName === 'acme/app')!;
  // acme/app has only a low(1) alert left, so it must rank below acme/lib.
  assert.ok(app.riskScore < lib.riskScore, `${app.riskScore} !< ${lib.riskScore}`);
});
check('ecosystem breakdown aggregates open alerts', () => {
  assert.equal(data.ecosystems[0].ecosystem, 'npm');
  assert.equal(data.ecosystems[0].open, 3);
  assert.equal(data.ecosystems[0].repos, 2);
});
check('aging buckets contain every open alert', () => {
  assert.equal(
    data.aging.reduce((s, b) => s + b.count, 0),
    3,
  );
});

/* 5. Owner scoping */
const mixedAlerts = [
  alert('acme/app', 1, { severity: 'critical', createdAt: iso('2026-03-01') }),
  alert('tester/side-project', 2, { severity: 'low', createdAt: iso('2026-03-01') }),
];
const mixed = snapshot('2026-04-01', mixedAlerts, ['acme/app', 'tester/side-project']);

check('option list offers all / personal / orgs / each org (viewer shown once as personal)', () => {
  const opts = buildOwnerOptions(mixed);
  assert.deepEqual(opts.map((o) => o.value), ['all', 'personal', 'orgs', 'owner:acme']);
  assert.equal(opts.find((o) => o.value === 'personal')!.repos, 1);
  assert.equal(opts.find((o) => o.value === 'orgs')!.openAlerts, 1);
});

check('personal scope keeps only the viewer\'s repos and alerts', () => {
  const scoped = applyScope(mixed, 'personal')!;
  assert.deepEqual(scoped.repos.map((r) => r.fullName), ['tester/side-project']);
  assert.deepEqual(scoped.alerts.map((a) => a.key), ['tester/side-project#2']);
  assert.equal(scoped.meta.reposScanned, 1);
});

check('orgs scope keeps only organization repos', () => {
  const scoped = applyScope(mixed, 'orgs')!;
  assert.deepEqual(scoped.repos.map((r) => r.fullName), ['acme/app']);
});

check('single-owner scope narrows to that owner', () => {
  const scoped = applyScope(mixed, 'owner:acme')!;
  assert.deepEqual(scoped.repos.map((r) => r.fullName), ['acme/app']);
});

check('scoped metrics are recomputed, not just filtered', () => {
  const personal = computeDashboardData(applyScope(mixed, 'personal'), 'personal');
  assert.equal(personal.totals.repos, 1);
  assert.equal(personal.totals.openAlerts, 1);
  assert.equal(personal.totals.bySeverity.critical, 0);
  assert.equal(personal.totals.bySeverity.low, 1);

  const orgs = computeDashboardData(applyScope(mixed, 'orgs'), 'orgs');
  assert.equal(orgs.totals.bySeverity.critical, 1);
  assert.equal(orgs.totals.bySeverity.low, 0);
});

check('scope strings normalize (bare owner → owner: prefix)', () => {
  assert.equal(normalizeScope(undefined), 'all');
  assert.equal(normalizeScope(''), 'all');
  assert.equal(normalizeScope('personal'), 'personal');
  assert.equal(normalizeScope('acme'), 'owner:acme');
  assert.equal(normalizeScope('owner:acme'), 'owner:acme');
});

check('legacy fetches without ownerType still resolve personal vs orgs', () => {
  const legacy: Snapshot = {
    ...mixed,
    repos: mixed.repos.map((r) => ({ ...r, ownerType: null })),
  };
  const personal = applyScope(legacy, 'personal')!;
  assert.deepEqual(personal.repos.map((r) => r.fullName), ['tester/side-project']);
  const orgs = applyScope(legacy, 'orgs')!;
  assert.deepEqual(orgs.repos.map((r) => r.fullName), ['acme/app']);
});

/* 6. Trend window: increasing / decreasing derived from alert timestamps */
const windowed = snapshot(
  daysAgo(0),
  [
    // acme/app: two opened inside the window -> increasing
    alert('acme/app', 10, { createdAt: iso(daysAgo(2)) }),
    alert('acme/app', 11, { createdAt: iso(daysAgo(1)) }),
    // acme/lib: opened long ago, fixed inside the window -> decreasing
    alert('acme/lib', 12, {
      createdAt: iso(daysAgo(120)),
      state: 'fixed',
      fixedAt: iso(daysAgo(3)),
    }),
    // acme/old: opened and fixed before the window -> no delta
    alert('acme/old', 13, {
      createdAt: iso(daysAgo(200)),
      state: 'fixed',
      fixedAt: iso(daysAgo(150)),
    }),
  ],
  ['acme/app', 'acme/lib', 'acme/old'],
);
const wdata = computeDashboardData(windowed);

check('trend window is reported to the UI', () => {
  assert.equal(wdata.trendWindowDays, TREND_WINDOW_DAYS);
});
check('repos gaining alerts in the window are increasing', () => {
  assert.deepEqual(wdata.increasing.map((t) => t.fullName), ['acme/app']);
  assert.equal(wdata.increasing[0].delta, 2);
  assert.equal(wdata.increasing[0].current, 2);
  assert.equal(wdata.increasing[0].previous, 0);
});
check('repos fixing alerts in the window are decreasing', () => {
  assert.deepEqual(wdata.decreasing.map((t) => t.fullName), ['acme/lib']);
  assert.equal(wdata.decreasing[0].delta, -1);
});
check('activity older than the window is ignored', () => {
  const old = wdata.repos.find((r) => r.fullName === 'acme/old')!;
  assert.equal(old.delta, 0);
});
check('fetchedAt is surfaced from the fetch metadata', () => {
  assert.equal(wdata.fetchedAt, windowed.meta.takenAt);
  assert.equal(wdata.hasHistory, true);
});
check('an empty fetch degrades gracefully', () => {
  const none = computeDashboardData(null);
  assert.equal(none.hasHistory, false);
  assert.equal(none.fetchedAt, null);
  assert.equal(none.totals.openAlerts, 0);
  assert.deepEqual(none.daily, []);
});

check('the demo snapshot is deterministic and self-consistent', () => {
  const a = buildDemoSnapshot();
  const b = buildDemoSnapshot();
  assert.equal(a.repos.length, 14);
  assert.deepEqual(
    a.alerts.map((x) => x.key),
    b.alerts.map((x) => x.key),
  );
  const open = a.alerts.filter((x) => x.state === 'open').length;
  assert.equal(a.repos.reduce((n, r) => n + r.openAlerts, 0), open);
});

process.env.SESSION_SECRET = 'selftest-secret-selftest-secret-selftest';
const future = Math.floor(Date.now() / 1000) + 60;

check('a sealed session round-trips', () => {
  const back = unsealSession(sealSession({ token: 'gho_x', login: 'tester', exp: future }));
  assert.deepEqual(back, { token: 'gho_x', login: 'tester', exp: future });
});
check('a tampered, expired or foreign session is rejected', () => {
  const sealed = sealSession({ token: 'gho_x', login: 'tester', exp: future });
  const flipped = `${sealed.slice(0, 20)}${sealed[20] === 'A' ? 'B' : 'A'}${sealed.slice(21)}`;
  assert.equal(unsealSession(flipped), null);
  assert.equal(unsealSession(sealSession({ token: 'gho_x', login: 'tester', exp: 1 })), null);
  assert.equal(unsealSession('not-a-session'), null);
  assert.equal(unsealSession(undefined), null);
  process.env.SESSION_SECRET = 'a-different-secret-a-different-secret';
  assert.equal(unsealSession(sealed), null);
});

// ── Alert exports (copy buttons) ────────────────────────────────────────────
const exportAlerts = [
  alert('acme/low-only', 1, { severity: 'low', packageName: 'left-pad' }),
  alert('acme/web', 2, { severity: 'medium', packageName: 'lodash' }),
  alert('acme/web', 3, { severity: 'critical', packageName: 'requests', firstPatchedVersion: '2.32.0' }),
  alert('acme/api', 4, { severity: 'high', packageName: 'tokio', firstPatchedVersion: null }),
];
check('exports put the repo with the most severe alert first', () => {
  assert.deepEqual(groupByRepo(exportAlerts).map(([repo]) => repo), ['acme/web', 'acme/api', 'acme/low-only']);
  assert.equal(repoNames(exportAlerts), 'acme/web\nacme/api\nacme/low-only');
});
check('within a repo, alerts are listed most severe first', () => {
  const md = alertsMarkdown(exportAlerts);
  assert.ok(md.indexOf('`requests`') < md.indexOf('`lodash`'));
  assert.match(md, /patched in 2\.32\.0/);
  assert.match(md, /no patched version yet/);
});
check('the agent prompt carries instructions and every alert', () => {
  const prompt = agentFixPrompt(exportAlerts, new Date('2026-10-21T00:00:00Z'));
  assert.match(prompt, /fix\/dependabot-alerts-2026-10-21/);
  assert.match(prompt, /gh pr create/);
  assert.match(prompt, /direct, top-level dependencies/);
  assert.match(prompt, /4 in 3 repositories/);
  for (const a of exportAlerts) assert.ok(prompt.includes(a.htmlUrl), a.key);
});

// ── Fix triage ──────────────────────────────────────────────────────────────
check('versions compare numerically, pre-releases sort first', () => {
  assert.equal(compareVersions('4.17.21', '4.17.3'), 1);
  assert.equal(compareVersions('v2.0', '2.0.0'), 0);
  assert.equal(compareVersions('1.2.0-rc1', '1.2.0'), -1);
  assert.equal(compareVersions('latest', '1.0'), null);
  assert.equal(reachesPatch('4.17.21', '4.17.21'), true);
  assert.equal(reachesPatch('4.17.20', '4.17.21'), false);
  assert.equal(reachesPatch(null, '1.0'), null);
});
check('bumps are parsed from single and grouped Dependabot PRs', () => {
  assert.deepEqual(bumpFor('lodash', 'Bump lodash from 4.17.20 to 4.17.21', ''), { from: '4.17.20', to: '4.17.21' });
  assert.deepEqual(
    bumpFor('lodash', 'Bump lodash from 4.17.20 to 4.17.21 in /web', 'Bumps [lodash](https://github.com/lodash/lodash) from 4.17.20 to 4.17.21.'),
    { from: '4.17.20', to: '4.17.21' },
  );
  const grouped = 'Bumps the npm_and_yarn group with 2 updates:\n\nUpdates `next` from 14.2.3 to 15.5.24\nUpdates `postcss` from 8.4.31 to 8.5.6';
  assert.deepEqual(bumpFor('postcss', 'Bump the npm_and_yarn group across 1 directory with 2 updates', grouped), { from: '8.4.31', to: '8.5.6' });
  assert.deepEqual(bumpFor('@babel/traverse', 'Bump @babel/traverse from 7.22.5 to 7.23.2', ''), { from: '7.22.5', to: '7.23.2' });
  assert.equal(bumpFor('next', 'Bump nextra from 1 to 2', ''), null, 'prefix of another package name');
});
check('PRs only match alerts in the same directory and ecosystem', () => {
  const a = alert('acme/web', 9, { packageName: 'lodash', ecosystem: 'npm', manifestPath: 'web/package-lock.json' });
  const pr = (title: string, ref: string) => ({ title, body: '', head: { ref } });
  assert.ok(matchPr(a, pr('Bump lodash from 1.0.0 to 2.0.0 in /web', 'dependabot/npm_and_yarn/web/lodash-2.0.0')));
  assert.equal(matchPr(a, pr('Bump lodash from 1.0.0 to 2.0.0 in /api', 'dependabot/npm_and_yarn/api/lodash-2.0.0')), null);
  assert.equal(matchPr(a, pr('Bump lodash from 1.0.0 to 2.0.0', 'dependabot/pip/lodash-2.0.0')), null);
  assert.equal(matchPr(a, pr('Bump lodash from 1.0.0 to 2.0.0', 'feature/lodash')), null);
});
check('CI summary: failures win, then pending, then passing', () => {
  const ok = { status: 'completed', conclusion: 'success', name: 'build' };
  assert.equal(summarizeCi([ok], []).ci, 'passing');
  assert.equal(summarizeCi([ok, { status: 'in_progress', conclusion: null, name: 't' }], []).ci, 'pending');
  assert.equal(summarizeCi([ok], [{ state: 'failure', context: 'ci/legacy' }]).ci, 'failing');
  assert.equal(summarizeCi([], []).ci, 'none');
});
check('alerts are bucketed by what Dependabot has (or hasn’t) done', () => {
  const on = { enabled: true, paused: false, canEnable: true };
  const old = alert('acme/web', 1, { createdAt: '2026-01-01T00:00:00Z', firstPatchedVersion: '2.0.0' });
  const pr = (o: object) => ({ number: 5, title: '', url: '', state: 'open' as const, branch: '', headSha: '', createdAt: '', updatedAt: '', bumps: [], alerts: [1], ci: 'passing' as const, mergeableState: 'clean', reaches: true, ...o });
  assert.equal(classify(old, pr({}), on).action, 'review_dependabot_pr');
  assert.equal(classify(old, pr({ ci: 'failing' }), on).bucket, 'dependabot_pr_ci_failing');
  assert.equal(classify(old, pr({ reaches: false }), on).bucket, 'dependabot_pr_insufficient');
  assert.equal(classify(old, pr({ mergeableState: 'dirty' }), on).action, 'rebase_or_recreate_pr');
  assert.equal(classify(old, pr({ state: 'merged' }), on).bucket, 'merged_but_still_open');
  assert.equal(classify(old, pr({ state: 'closed' }), on).bucket, 'dependabot_pr_closed');
  assert.equal(classify(old, null, { ...on, enabled: false }).action, 'enable_security_updates');
  assert.equal(classify(old, null, { enabled: false, paused: false, canEnable: false }).action, 'manual_fix');
  assert.equal(classify(old, null, on).bucket, 'dependabot_did_not_open_pr');
  assert.equal(classify({ ...old, createdAt: new Date().toISOString() }, null, on).action, 'wait');
  assert.equal(classify({ ...old, firstPatchedVersion: null }, null, on).action, 'human_decision');
});

// ── MCP OAuth ───────────────────────────────────────────────────────────────
process.env.SESSION_SECRET = 'selftest-secret-selftest-secret-selftest';
check('sealed MCP blobs are bound to their kind', () => {
  const t = sealTyped('access', { gh: 'gho_x', login: 'me', cid: 'c', exp: future });
  assert.equal(unsealTyped<{ gh: string; exp: number }>('access', t)?.gh, 'gho_x');
  assert.equal(unsealTyped('refresh', t), null);
  assert.equal(unsealTyped('code', t), null);
  assert.equal(unsealSession(t), null, 'an access token is not a session cookie');
  assert.equal(unsealTyped('access', sealSession({ token: 'gho_x', login: 'me', exp: future })), null);
  assert.equal(unsealTyped('access', sealTyped('access', { exp: 1 })), null, 'expired');
});
check('PKCE S256 verification', () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.ok(pkceMatches(verifier, challenge));
  assert.ok(!pkceMatches(`${verifier}x`, challenge));
  assert.ok(!pkceMatches('short', challenge));
});
check('redirect URIs: https, loopback http, app schemes only', () => {
  assert.ok(validRedirectUri('https://claude.ai/api/mcp/auth_callback'));
  assert.ok(validRedirectUri('http://localhost:53682/callback'));
  assert.ok(validRedirectUri('http://127.0.0.1:9000/cb'));
  assert.ok(validRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback'));
  assert.ok(!validRedirectUri('http://evil.example/cb'));
  assert.ok(!validRedirectUri('javascript:alert(1)'));
  assert.ok(!validRedirectUri('https://x.example/cb#frag'));
  const reg = registerClient({ redirect_uris: ['http://localhost:1/cb'], client_name: 'Claude Code' });
  assert.ok(reg.ok);
  assert.ok(!registerClient({ redirect_uris: ['http://localhost:1/cb'], token_endpoint_auth_method: 'client_secret_post' }).ok);
});

// ── async: MCP protocol + end-to-end triage against a fake GitHub ──────────
async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fakeGitHub(routes: Record<string, unknown>): GitHubClient {
  const find = (path: string) => {
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) throw Object.assign(new Error(`unexpected GET ${path}`), { status: 404 });
    return routes[key];
  };
  return {
    errors: [],
    get: async (p: string) => find(p),
    paginate: async (p: string) => find(p),
    request: async (p: string) => ({ status: 200, headers: new Headers(), body: find(p) }),
    viewer: async () => 'tester',
    rateLimit: async () => ({ remaining: 4999, limit: 5000 }),
  } as unknown as GitHubClient;
}

(async () => {
  await checkAsync('MCP initialize, tools/list and notifications', async () => {
    const ctx = async () => ({ gh: fakeGitHub({}), login: 'tester' });
    const init = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, ctx, '2025-11-25')) as { result: { protocolVersion: string; instructions: string } };
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.match(init.result.instructions, /triage_alerts/);
    const list = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx, '2025-11-25')) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    assert.deepEqual(list.result.tools.map((t) => t.name), ['whoami', 'list_open_alerts', 'triage_alerts', 'get_dependabot_pr', 'manual_fix_prompt']);
    assert.ok(list.result.tools.every((t) => t.annotations.readOnlyHint));
    assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx, '2025-11-25'), null);
    const bad = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'triage_alerts', arguments: { repos: ['nope'] } } }, ctx, '2025-11-25')) as { result: { isError: boolean } };
    assert.equal(bad.result.isError, true);
  });

  await checkAsync('triage end to end: ready PR, failing PR, and a manual fix', async () => {
    const rawAlert = (number: number, pkg: string, patched: string | null, manifest = 'package-lock.json') => ({
      number,
      state: 'open',
      html_url: `https://github.com/acme/web/security/dependabot/${number}`,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      fixed_at: null,
      dismissed_at: null,
      dismissed_reason: null,
      dependency: { package: { ecosystem: 'npm', name: pkg }, manifest_path: manifest, scope: 'runtime' },
      security_advisory: { ghsa_id: `GHSA-${number}`, cve_id: null, summary: `${pkg} bug`, severity: 'high' },
      security_vulnerability: { severity: 'high', vulnerable_version_range: '< 9', first_patched_version: patched ? { identifier: patched } : null, package: { ecosystem: 'npm', name: pkg } },
    });
    const pull = (number: number, title: string, sha: string) => ({
      number, title, body: '', html_url: `https://github.com/acme/web/pull/${number}`, state: 'open', merged_at: null,
      created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', user: { login: 'dependabot[bot]' },
      head: { ref: `dependabot/npm_and_yarn/x-${number}`, sha },
    });
    const gh = fakeGitHub({
      '/repos/acme/web/dependabot/alerts': [rawAlert(1, 'lodash', '4.17.21'), rawAlert(2, 'axios', '1.7.4'), rawAlert(3, 'minimist', '1.2.6')],
      '/repos/acme/web/automated-security-fixes': { enabled: true, paused: false },
      '/repos/acme/web/pulls/10': { mergeable_state: 'clean' },
      '/repos/acme/web/pulls/11': { mergeable_state: 'clean' },
      '/repos/acme/web/pulls': [pull(10, 'Bump lodash from 4.17.20 to 4.17.21', 'aaa'), pull(11, 'Bump axios from 1.6.0 to 1.7.4', 'bbb')],
      '/repos/acme/web/commits/aaa/check-runs': { check_runs: [{ status: 'completed', conclusion: 'success', name: 'ci' }] },
      '/repos/acme/web/commits/bbb/check-runs': { check_runs: [{ status: 'completed', conclusion: 'failure', name: 'test' }] },
      '/repos/acme/web/commits/': { statuses: [] },
      '/repos/acme/web': { default_branch: 'main', permissions: { admin: true } },
    });
    const t = await triageRepo(gh, 'acme/web');
    const by = Object.fromEntries(t.alerts.map((a) => [a.packageName, a]));
    assert.equal(by.lodash.action, 'review_dependabot_pr');
    assert.equal(by.lodash.pr, 10);
    assert.equal(by.axios.bucket, 'dependabot_pr_ci_failing');
    assert.equal(by.minimist.bucket, 'dependabot_did_not_open_pr');
    assert.equal(t.securityUpdates.enabled, true);
    assert.ok(t.nextSteps.some((s) => s.includes('#10')));
    assert.ok(t.nextSteps.some((s) => s.includes('manual_fix_prompt')));
  });

  console.log(`\n${passed} checks passed\n`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
