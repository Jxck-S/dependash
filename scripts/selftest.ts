#!/usr/bin/env tsx
/**
 * Dependency-free self-test for the aggregation engine.
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

console.log(`\n${passed} checks passed\n`);
