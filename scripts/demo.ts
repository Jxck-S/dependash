#!/usr/bin/env tsx
/**
 * Generates a synthetic fetch so you can explore the dashboard without a GitHub
 * token — and so screenshots never expose anyone's real repositories.
 *
 *   npm run demo            # write demo data, then `npm run dev`
 *
 * Writes to the same single last-fetch file the real collector uses, so it will
 * be replaced the next time you press "Fetch now".
 */

import { writeSnapshot, localDateString } from '../src/lib/store';
import {
  AlertRecord,
  RepoRecord,
  Severity,
  Snapshot,
  emptySeverityCounts,
} from '../src/lib/types';

const VIEWER = 'octocat';

interface RepoSpec {
  name: string;
  owner: string;
  ownerType: 'User' | 'Organization';
  language: string;
  enabled: boolean | null;
  archived?: boolean;
  fork?: boolean;
  private?: boolean;
}

const REPOS: RepoSpec[] = [
  { name: 'payments-api', owner: 'acme-corp', ownerType: 'Organization', language: 'TypeScript', enabled: true },
  { name: 'checkout-web', owner: 'acme-corp', ownerType: 'Organization', language: 'TypeScript', enabled: true },
  { name: 'billing-worker', owner: 'acme-corp', ownerType: 'Organization', language: 'Go', enabled: true },
  { name: 'data-pipeline', owner: 'acme-corp', ownerType: 'Organization', language: 'Python', enabled: true },
  { name: 'infra-terraform', owner: 'acme-corp', ownerType: 'Organization', language: 'HCL', enabled: false },
  { name: 'design-system', owner: 'widgetworks', ownerType: 'Organization', language: 'TypeScript', enabled: true },
  { name: 'mobile-app', owner: 'widgetworks', ownerType: 'Organization', language: 'Kotlin', enabled: true },
  { name: 'legacy-reports', owner: 'widgetworks', ownerType: 'Organization', language: 'Ruby', enabled: null, archived: true },
  { name: 'dotfiles', owner: VIEWER, ownerType: 'User', language: 'Shell', enabled: false },
  { name: 'side-project', owner: VIEWER, ownerType: 'User', language: 'JavaScript', enabled: true, private: true },
  { name: 'blog', owner: VIEWER, ownerType: 'User', language: 'TypeScript', enabled: true },
  { name: 'scratchpad', owner: VIEWER, ownerType: 'User', language: 'Python', enabled: true },
  { name: 'homelab', owner: VIEWER, ownerType: 'User', language: 'Go', enabled: true, private: true },
  { name: 'awesome-fork', owner: VIEWER, ownerType: 'User', language: 'Rust', enabled: null, fork: true },
];

const PACKAGES: Array<{ name: string; ecosystem: string; manifest: string }> = [
  { name: 'lodash', ecosystem: 'npm', manifest: 'package.json' },
  { name: 'axios', ecosystem: 'npm', manifest: 'package.json' },
  { name: 'next', ecosystem: 'npm', manifest: 'package.json' },
  { name: 'requests', ecosystem: 'pip', manifest: 'requirements.txt' },
  { name: 'cryptography', ecosystem: 'pip', manifest: 'requirements.txt' },
  { name: 'golang.org/x/net', ecosystem: 'go', manifest: 'go.mod' },
  { name: 'nokogiri', ecosystem: 'rubygems', manifest: 'Gemfile.lock' },
  { name: 'tokio', ecosystem: 'cargo', manifest: 'Cargo.toml' },
];

const SUMMARIES = [
  'Prototype pollution in deep merge',
  'Regular expression denial of service',
  'Improper certificate validation',
  'Server-side request forgery in URL parser',
  'Denial of service via malformed input',
  'Path traversal in archive extraction',
  'Cross-site scripting in template renderer',
];

const SEVERITY_MIX: Severity[] = [
  'low', 'low', 'medium', 'medium', 'medium', 'high', 'high', 'critical',
];

/** Deterministic PRNG so the demo looks identical on every machine. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const rand = makeRandom(20260916);

const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(9 + Math.floor(rand() * 8), Math.floor(rand() * 60), 0, 0);
  return d.toISOString();
}

const alerts: AlertRecord[] = [];
let counter = 0;

function addAlert(repoFullName: string, opts: { openedDaysAgo: number; fixedDaysAgo?: number; dismissed?: boolean }) {
  counter += 1;
  const pkg = pick(PACKAGES);
  const severity = pick(SEVERITY_MIX);
  const createdAt = daysAgoIso(opts.openedDaysAgo);
  const fixed = opts.fixedDaysAgo !== undefined;
  const closedAt = fixed ? daysAgoIso(opts.fixedDaysAgo!) : null;

  alerts.push({
    key: `${repoFullName}#${counter}`,
    repo: repoFullName,
    number: counter,
    state: opts.dismissed ? 'dismissed' : fixed ? 'fixed' : 'open',
    severity,
    ghsaId: `GHSA-demo-${String(counter).padStart(4, '0')}`,
    cveId: rand() > 0.4 ? `CVE-2026-${1000 + counter}` : null,
    summary: `${pkg.name}: ${pick(SUMMARIES)}`,
    cvssScore: Math.round((3 + rand() * 6.9) * 10) / 10,
    ecosystem: pkg.ecosystem,
    packageName: pkg.name,
    manifestPath: pkg.manifest,
    vulnerableVersionRange: '< 2.4.1',
    firstPatchedVersion: '2.4.1',
    scope: rand() > 0.3 ? 'runtime' : 'development',
    createdAt,
    updatedAt: closedAt ?? createdAt,
    fixedAt: opts.dismissed ? null : closedAt,
    dismissedAt: opts.dismissed ? closedAt : null,
    dismissedReason: opts.dismissed ? 'tolerable_risk' : null,
    htmlUrl: `https://github.com/${repoFullName}/security/dependabot/${counter}`,
    advisoryUrl: `https://github.com/advisories/GHSA-demo-${String(counter).padStart(4, '0')}`,
  });
}

// Historic churn: ~9 months of alerts opening and (mostly) getting fixed.
for (const spec of REPOS) {
  if (spec.enabled !== true) continue;
  const full = `${spec.owner}/${spec.name}`;
  const activity = 14 + Math.floor(rand() * 26);

  for (let i = 0; i < activity; i++) {
    const opened = 10 + Math.floor(rand() * 260);
    const roll = rand();
    if (roll < 0.78) {
      // fixed some time after opening
      const ttf = 1 + Math.floor(rand() * 45);
      addAlert(full, { openedDaysAgo: opened, fixedDaysAgo: Math.max(0, opened - ttf) });
    } else if (roll < 0.86) {
      addAlert(full, { openedDaysAgo: opened, fixedDaysAgo: Math.max(0, opened - 20), dismissed: true });
    } else {
      addAlert(full, { openedDaysAgo: opened });
    }
  }

  // A few still-open alerts of varying ages, so aging buckets are interesting.
  const stillOpen = Math.floor(rand() * 7);
  for (let i = 0; i < stillOpen; i++) {
    addAlert(full, { openedDaysAgo: Math.floor(rand() * 150) });
  }
}

const repos: RepoRecord[] = REPOS.map((spec) => {
  const fullName = `${spec.owner}/${spec.name}`;
  const mine = alerts.filter((a) => a.repo === fullName);
  const open = mine.filter((a) => a.state === 'open');
  const bySeverity = emptySeverityCounts();
  for (const a of open) bySeverity[a.severity] += 1;

  return {
    fullName,
    owner: spec.owner,
    name: spec.name,
    ownerType: spec.ownerType,
    private: Boolean(spec.private),
    fork: Boolean(spec.fork),
    archived: Boolean(spec.archived),
    disabled: false,
    language: spec.language,
    defaultBranch: 'main',
    stars: Math.floor(rand() * 400),
    pushedAt: daysAgoIso(Math.floor(rand() * 30)),
    htmlUrl: `https://github.com/${fullName}`,
    dependabotUrl: `https://github.com/${fullName}/security/dependabot`,
    dependabotAlertsEnabled: spec.enabled,
    dependabotSecurityUpdatesEnabled: spec.enabled === true ? rand() > 0.5 : spec.enabled,
    enablementSource: spec.archived ? 'archived' : spec.enabled === null ? 'unknown' : 'alerts-api-ok',
    openAlerts: open.length,
    openBySeverity: bySeverity,
    fixedAlerts: mine.filter((a) => a.state === 'fixed').length,
    dismissedAlerts: mine.filter((a) => a.state === 'dismissed').length,
    error: null,
  };
});

const snapshot: Snapshot = {
  schemaVersion: 1,
  meta: {
    date: localDateString(),
    takenAt: new Date().toISOString(),
    viewer: VIEWER,
    source: 'github-api',
    toolVersion: 'dependash-demo',
    reposScanned: repos.length,
    reposWithAlertsEnabled: repos.filter((r) => r.dependabotAlertsEnabled === true).length,
    reposSkipped: 0,
    durationMs: 8200,
    errors: [],
  },
  repos,
  alerts,
};

const file = writeSnapshot(snapshot);
const open = alerts.filter((a) => a.state === 'open').length;
console.log(`demo data written: ${file}`);
console.log(`  ${repos.length} repositories · ${alerts.length} alerts · ${open} open`);
console.log('');
console.log('Next: npm run dev  →  http://localhost:3939');
