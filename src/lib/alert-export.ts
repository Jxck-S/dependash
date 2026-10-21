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
  const fix = a.firstPatchedVersion ? `patched in ${a.firstPatchedVersion}` : 'no patched version yet';
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
  return `You are a software engineer with authenticated GitHub access (the \`gh\` CLI and git) to the repositories below. Fix the open Dependabot security alerts listed at the end by bringing each repository's dependencies up to date — one pull request per repository.

## Approach: update from the top down

Fix alerts by updating the project's **direct, top-level dependencies** to their latest stable versions, not by patching each vulnerable package in isolation. Most alerts are in transitive dependencies that a current version of the parent package already pulls in fixed, and keeping everything current prevents the next batch of alerts. Bigger upgrades — including new major versions — are expected; handle their breaking changes rather than avoiding them.

## How to work

1. **Order:** work through the repositories in the order listed — they are sorted most severe first.
2. **Confirm first:** check each alert is still open, e.g. \`gh api repos/OWNER/REPO/dependabot/alerts/NUMBER --jq .state\`. Skip alerts that are already fixed or dismissed.
3. **For each repository:**
   1. Clone it (or pull its default branch) and create a branch named \`fix/dependabot-alerts-${date}\`.
   2. Find which direct dependency brings in each vulnerable package (\`npm ls <pkg>\`, \`pip show\`/\`pipdeptree\`, \`cargo tree -i <pkg>\`, \`go mod why\`, \`mvn dependency:tree\`, …). Start with the parents of critical and high alerts.
   3. Update direct dependencies to their latest stable releases with the project's own package manager, so manifests and lockfiles are regenerated together (npm/pnpm/yarn, pip/poetry/uv, bundler, cargo, go modules, maven/gradle, …). Update the framework or runtime-level packages first, then the libraries that depend on them. Update the rest of the direct dependencies too, so the project ends up current — not just the ones tied to an alert.
   4. For major-version upgrades, read the changelog or migration guide and update the code, config and types for the breaking changes. If the toolchain itself needs a newer version (Node, Python, Go, Java, …), update its version files and CI config to match.
   5. Only if a vulnerable package still isn't fixed after its parents are current, pin it with the ecosystem's override or resolution mechanism, and leave a comment saying why.
   6. Install, build, lint and run the full test suite. Fix everything the updates broke. If there are no tests, build and start the application and exercise its main paths to check for errors.
   7. Check the updates didn't introduce new problems: run the ecosystem's audit tool (\`npm audit\`, \`pip-audit\`, \`cargo audit\`, \`bundle audit\`, \`govulncheck\`, …) and confirm the listed advisories are gone, with no new vulnerabilities, peer-dependency conflicts or deprecation errors.
   8. Commit, push the branch, and open a pull request with \`gh pr create\` against the default branch. In the description, list each alert fixed (severity, package, GHSA/CVE, alert link) and which update fixed it, every direct dependency updated (old → new version, majors called out), the breaking changes you handled, what you ran to test it, and any follow-ups.
4. **Don't** push to default branches, merge pull requests, or dismiss alerts. If an update can't be made safely, or an alert has no fixed version, leave it and explain why.
5. **When finished,** reply with a table: repository, pull request link, alerts fixed, major upgrades made, alerts skipped and why.

## Open Dependabot alerts (${alerts.length} in ${repos} ${repos === 1 ? 'repository' : 'repositories'}, exported from dependash on ${date})

${alertsMarkdown(alerts)}
`;
}
