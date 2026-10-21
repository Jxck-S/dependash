/**
 * Plain-text exports of an alert list, for the copy buttons on alert tables:
 * a Markdown list grouped by repo, the bare repo names, and that list wrapped
 * in instructions for an AI coding agent to fix the alerts and open PRs.
 */

import { AlertRecord, Severity } from './types';

const WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** Alerts grouped by repo; repos with the most severe alerts first, then most alerts. */
export function groupByRepo(alerts: AlertRecord[]): [string, AlertRecord[]][] {
  const groups = new Map<string, AlertRecord[]>();
  for (const a of alerts) {
    const list = groups.get(a.repo) ?? [];
    list.push(a);
    groups.set(a.repo, list);
  }
  const worst = (list: AlertRecord[]) => Math.max(...list.map((a) => WEIGHT[a.severity]));
  return [...groups.entries()]
    .map(([repo, list]) => [repo, [...list].sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity])] as [string, AlertRecord[]])
    .sort(([ra, a], [rb, b]) => worst(b) - worst(a) || b.length - a.length || ra.localeCompare(rb));
}

function alertLine(a: AlertRecord): string {
  const where = [a.ecosystem, a.manifestPath, a.scope === 'development' ? 'dev dependency' : null]
    .filter(Boolean)
    .join(', ');
  const fix = a.firstPatchedVersion ? `fix: upgrade to >= ${a.firstPatchedVersion}` : 'no patched version yet';
  const ids = [a.ghsaId, a.cveId].filter(Boolean).join(' / ');
  return (
    `- **${a.severity.toUpperCase()}** \`${a.packageName}\` (${where}) — ${a.summary}\n` +
    `  - vulnerable: ${a.vulnerableVersionRange ?? 'unknown'} · ${fix}` +
    `${ids ? ` · ${ids}` : ''} · alert #${a.number}: ${a.htmlUrl}`
  );
}

export function alertsMarkdown(alerts: AlertRecord[]): string {
  return groupByRepo(alerts)
    .map(([repo, list]) => `### ${repo} (${list.length} alert${list.length === 1 ? '' : 's'})\n${list.map(alertLine).join('\n')}`)
    .join('\n\n');
}

export function repoNames(alerts: AlertRecord[]): string {
  return groupByRepo(alerts)
    .map(([repo]) => repo)
    .join('\n');
}

export function agentFixPrompt(alerts: AlertRecord[], now = new Date()): string {
  const repos = groupByRepo(alerts).length;
  const date = now.toISOString().slice(0, 10);
  return `You are a software engineer with authenticated GitHub access (the \`gh\` CLI and git) to the repositories below. Fix the open Dependabot security alerts listed at the end, one pull request per repository.

## How to work

1. **Order:** work through the repositories in the order listed — they are sorted most severe first. Within a repository, fix critical and high alerts before medium and low.
2. **Confirm first:** before changing anything, check each alert is still open, e.g. \`gh api repos/OWNER/REPO/dependabot/alerts/NUMBER --jq .state\`. Skip alerts that are already fixed or dismissed.
3. **For each repository:**
   1. Clone it (or pull its default branch) and create a branch named \`fix/dependabot-alerts-${date}\`.
   2. Upgrade each vulnerable package to at least the patched version shown, using the project's own package manager so lockfiles are regenerated (npm/pnpm/yarn, pip/poetry/uv, bundler, cargo, go modules, maven/gradle, …). For a transitive dependency, upgrade the direct dependency that pulls it in; if none fixes it, use the ecosystem's override or resolution mechanism.
   3. Prefer the smallest upgrade that fixes the advisory. If it needs a new major version, read the changelog or migration notes and update the code for any breaking changes.
   4. Install, build, lint and run the test suite. Fix anything the upgrades broke. If there are no tests, at least build and start the application and check it for errors.
   5. Check the upgrades didn't introduce new problems: run the ecosystem's audit tool (\`npm audit\`, \`pip-audit\`, \`cargo audit\`, \`bundle audit\`, \`govulncheck\`, …), confirm the targeted advisories are gone, and that no new vulnerabilities or peer-dependency conflicts appeared.
   6. Commit with a message naming the advisories fixed, push the branch, and open a pull request with \`gh pr create\` against the default branch. In the description, list each alert fixed (severity, package, old → new version, GHSA/CVE, alert link), what you ran to test it, and any breaking changes or follow-ups.
4. **Don't** push to default branches, merge pull requests, or dismiss alerts. If an alert has no patched version, or can't be upgraded safely, leave it and explain why.
5. **When finished,** reply with a table: repository, pull request link, alerts fixed, alerts skipped and why.

## Open Dependabot alerts (${alerts.length} in ${repos} ${repos === 1 ? 'repository' : 'repositories'}, exported from dependash on ${date})

${alertsMarkdown(alerts)}
`;
}
