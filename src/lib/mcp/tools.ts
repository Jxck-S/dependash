/**
 * The tools dependash exposes to AI agents over MCP. All read-only: they call
 * GitHub with GETs only, and hand the agent the `gh` commands for anything
 * that needs a write.
 */

import { agentFixPrompt } from '../alert-export';
import { fetchOpenAlerts, filterSeverity, manualAlerts, summarizeCi, triageRepo } from '../fixes';
import { GitHubClient, GitHubError } from '../github';
import { AlertRecord, SEVERITIES, Severity } from '../types';

export interface ToolContext {
  gh: GitHubClient;
  login: string | null;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export class ToolInputError extends Error {}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_TRIAGE_REPOS = 20;

const severityProp = {
  type: 'string',
  enum: SEVERITIES,
  description: 'Only include alerts at or above this severity.',
};

function repoArg(v: unknown, field = 'repo'): string {
  if (typeof v !== 'string' || !REPO.test(v)) throw new ToolInputError(`${field} must look like "owner/name".`);
  return v;
}

function reposArg(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length) throw new ToolInputError('repos must be a non-empty array of "owner/name".');
  if (v.length > MAX_TRIAGE_REPOS) throw new ToolInputError(`At most ${MAX_TRIAGE_REPOS} repos per call; split the list.`);
  return v.map((r) => repoArg(r, 'repos[]'));
}

function severityArg(v: unknown): Severity | undefined {
  if (v === undefined || v === null) return undefined;
  if (!SEVERITIES.includes(v as Severity)) throw new ToolInputError(`min_severity must be one of ${SEVERITIES.join(', ')}.`);
  return v as Severity;
}

function truncate(s: string | null | undefined, n: number): string | null {
  if (!s) return s ?? null;
  return s.length > n ? `${s.slice(0, n)}\n… [truncated ${s.length - n} chars]` : s;
}

const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|go\.sum|packages\.lock\.json|gradle\.lockfile|pubspec\.lock|mix\.lock)$/;

/* ------------------------------ tools ------------------------------ */

const whoami: Tool = {
  name: 'whoami',
  title: 'Who am I',
  description: 'The GitHub account this MCP connection acts as, plus remaining API quota.',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, { gh, login }) {
    const [viewer, rateLimit] = await Promise.all([login ? Promise.resolve(login) : gh.viewer(), gh.rateLimit()]);
    return { login: viewer, rateLimit };
  },
};

const listOpenAlerts: Tool = {
  name: 'list_open_alerts',
  title: 'List open Dependabot alerts',
  description:
    'Open Dependabot alerts, grouped by repository and sorted most severe first. Pass `repo` for one repository; ' +
    'otherwise scans every repository the account can see (personal, org and collaborator repos — this can take a minute ' +
    'for large accounts; narrow it with `owner`). Use this first to choose which repos to pass to triage_alerts.',
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'Single repository, "owner/name".' },
      owner: { type: 'string', description: 'Only repos owned by this user or org.' },
      min_severity: severityProp,
      include_alerts: {
        type: 'boolean',
        description: 'Include each alert (package, GHSA, patched version). Default true; false returns per-repo counts only.',
      },
    },
  },
  async run(args, { gh }) {
    const min = severityArg(args.min_severity);
    const withAlerts = args.include_alerts !== false;
    let alerts: AlertRecord[];
    let scanned: number;
    const errors: string[] = [];
    if (args.repo !== undefined) {
      alerts = await fetchOpenAlerts(gh, repoArg(args.repo));
      scanned = 1;
    } else {
      const owners = typeof args.owner === 'string' && args.owner ? [args.owner] : undefined;
      const result = await gh.collect({ owners, concurrency: 8 });
      alerts = result.alerts.filter((a) => a.state === 'open');
      scanned = result.repos.length;
      errors.push(...gh.errors);
    }
    alerts = filterSeverity(alerts, min);

    const byRepo = new Map<string, AlertRecord[]>();
    for (const a of alerts) byRepo.set(a.repo, [...(byRepo.get(a.repo) ?? []), a]);
    const rank = (s: Severity) => 4 - SEVERITIES.indexOf(s);
    const repos = [...byRepo.entries()]
      .map(([repo, list]) => {
        const counts = Object.fromEntries(SEVERITIES.map((s) => [s, list.filter((a) => a.severity === s).length]));
        list.sort((a, b) => rank(b.severity) - rank(a.severity) || a.number - b.number);
        return {
          repo,
          open: list.length,
          bySeverity: counts,
          alerts: withAlerts
            ? list.map((a) => ({
                number: a.number,
                severity: a.severity,
                package: a.packageName,
                ecosystem: a.ecosystem,
                manifest: a.manifestPath,
                vulnerable: a.vulnerableVersionRange,
                patched: a.firstPatchedVersion,
                ghsa: a.ghsaId,
                summary: a.summary,
                url: a.htmlUrl,
              }))
            : undefined,
        };
      })
      .sort(
        (a, b) =>
          Math.max(...byRepo.get(b.repo)!.map((x) => rank(x.severity))) - Math.max(...byRepo.get(a.repo)!.map((x) => rank(x.severity))) ||
          b.open - a.open,
      );
    return { reposScanned: scanned, reposWithAlerts: repos.length, openAlerts: alerts.length, repos, errors: errors.slice(0, 20) };
  },
};

const triageAlerts: Tool = {
  name: 'triage_alerts',
  title: 'Triage alerts against Dependabot PRs',
  description:
    'For each open alert in the given repos, checks whether Dependabot already opened a fix PR, whether that PR reaches the ' +
    'patched version, passes CI and merges cleanly, and whether Dependabot security updates are on. Every alert gets a bucket ' +
    'and an action (review_dependabot_pr, wait, fix_on_pr_branch, rebase_or_recreate_pr, enable_security_updates, manual_fix, ' +
    'human_decision), and each repo gets ordered nextSteps with the exact gh commands. Always do this before fixing anything by hand.',
  inputSchema: {
    type: 'object',
    required: ['repos'],
    properties: {
      repos: { type: 'array', items: { type: 'string' }, maxItems: MAX_TRIAGE_REPOS, description: 'Repositories, "owner/name".' },
      min_severity: severityProp,
    },
  },
  async run(args, { gh }) {
    const repos = reposArg(args.repos);
    const min = severityArg(args.min_severity);
    const results = await Promise.all(repos.map((r) => triageRepo(gh, r, min)));
    const totals: Record<string, number> = {};
    for (const r of results) for (const [k, v] of Object.entries(r.counts)) totals[k] = (totals[k] ?? 0) + (v ?? 0);
    return { totals, repos: results };
  },
};

const getDependabotPr: Tool = {
  name: 'get_dependabot_pr',
  title: 'Inspect a Dependabot PR for review',
  description:
    'Everything needed to review a Dependabot pull request: its description (release notes / changelog), changed files with ' +
    'manifest diffs (lockfile diffs summarized), CI check results with failure summaries, and merge state. Use it on PRs that ' +
    'triage_alerts marks review_dependabot_pr or fix_on_pr_branch.',
  inputSchema: {
    type: 'object',
    required: ['repo', 'number'],
    properties: {
      repo: { type: 'string', description: '"owner/name"' },
      number: { type: 'integer', description: 'Pull request number.' },
    },
  },
  async run(args, { gh }) {
    const repo = repoArg(args.repo);
    const number = Number(args.number);
    if (!Number.isInteger(number) || number < 1) throw new ToolInputError('number must be a PR number.');

    const pr = await gh.get<{
      title: string;
      body: string | null;
      html_url: string;
      state: string;
      merged: boolean;
      draft: boolean;
      mergeable: boolean | null;
      mergeable_state: string;
      user: { login: string } | null;
      head: { ref: string; sha: string };
      base: { ref: string };
      commits: number;
      additions: number;
      deletions: number;
      changed_files: number;
      labels: { name: string }[];
    }>(`/repos/${repo}/pulls/${number}`);

    const [files, runs, status] = await Promise.all([
      gh.paginate<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>(
        `/repos/${repo}/pulls/${number}/files?per_page=100`,
        3,
      ),
      gh
        .get<{
          check_runs: {
            name: string;
            status: string;
            conclusion: string | null;
            html_url: string | null;
            output?: { title: string | null; summary: string | null };
          }[];
        }>(`/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`)
        .catch(() => ({ check_runs: [] })),
      gh
        .get<{ statuses: { state: string; context: string; description: string | null; target_url: string | null }[] }>(
          `/repos/${repo}/commits/${pr.head.sha}/status`,
        )
        .catch(() => ({ statuses: [] })),
    ]);

    let budget = 24_000;
    const changed = files.map((f) => {
      const lock = LOCKFILE.test(f.filename);
      let patch: string | null = null;
      if (!lock && f.patch && budget > 0) {
        patch = truncate(f.patch, Math.min(6000, budget));
        budget -= patch?.length ?? 0;
      }
      return {
        file: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: lock ? '(lockfile — diff omitted)' : (patch ?? (f.patch ? '(omitted — size budget reached)' : null)),
      };
    });

    const { ci } = summarizeCi(runs.check_runs, status.statuses);
    return {
      repo,
      number,
      title: pr.title,
      url: pr.html_url,
      author: pr.user?.login ?? null,
      isDependabot: pr.user?.login === 'dependabot[bot]',
      state: pr.merged ? 'merged' : pr.state,
      draft: pr.draft,
      branch: pr.head.ref,
      base: pr.base.ref,
      mergeable: pr.mergeable,
      mergeableState: pr.mergeable_state,
      labels: pr.labels.map((l) => l.name),
      size: { commits: pr.commits, files: pr.changed_files, additions: pr.additions, deletions: pr.deletions },
      ci,
      checks: runs.check_runs.map((r) => ({
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        url: r.html_url,
        summary: r.conclusion && r.conclusion !== 'success' && r.conclusion !== 'skipped' ? truncate(r.output?.summary, 1500) : undefined,
      })),
      statuses: status.statuses.map((s) => ({ context: s.context, state: s.state, description: s.description, url: s.target_url })),
      description: truncate(pr.body, 8000),
      files: changed,
      reviewChecklist: [
        'Does the bump reach the first patched version for every alert it is meant to fix?',
        'Read the release notes in the description: any breaking changes, removed APIs, or new runtime requirements?',
        'For major versions, search the codebase for the APIs that changed.',
        'Is CI green and actually exercising the code that uses this dependency? If there is no CI, check out the branch and build/test locally.',
        `Failing check logs: \`gh run view --log-failed -R ${repo} <run-id>\` or \`gh pr checks ${number} -R ${repo}\`.`,
      ],
    };
  },
};

const manualFixPrompt: Tool = {
  name: 'manual_fix_prompt',
  title: 'Instructions for alerts Dependabot can’t fix',
  description:
    'Detailed fix instructions (update direct dependencies top-down, regenerate lockfiles, test, open one PR per repo) for the ' +
    'alerts that need a hand-made fix. Give `alerts` as numbers from triage_alerts; omit them to use every alert triage marks ' +
    'manual_fix or dependabot_pr_insufficient.',
  inputSchema: {
    type: 'object',
    required: ['repo'],
    properties: {
      repo: { type: 'string', description: '"owner/name"' },
      alerts: { type: 'array', items: { type: 'integer' }, description: 'Alert numbers to include.' },
    },
  },
  async run(args, { gh }) {
    const repo = repoArg(args.repo);
    let numbers: number[];
    if (Array.isArray(args.alerts) && args.alerts.length) {
      numbers = args.alerts.map(Number).filter(Number.isInteger);
    } else {
      numbers = manualAlerts(await triageRepo(gh, repo));
    }
    const open = await fetchOpenAlerts(gh, repo);
    const chosen = open.filter((a) => numbers.includes(a.number));
    if (!chosen.length) return { repo, alerts: 0, prompt: null, note: 'None of those alerts are open — nothing to fix by hand.' };
    return { repo, alerts: chosen.length, prompt: agentFixPrompt(chosen) };
  },
};

export const TOOLS: Tool[] = [whoami, listOpenAlerts, triageAlerts, getDependabotPr, manualFixPrompt];

export const SERVER_INSTRUCTIONS = `dependash gives read-only access to the Dependabot alerts of every repository the signed-in GitHub account can see, and works out which ones Dependabot's own pull requests already fix.

Workflow for "fix these alerts":
1. list_open_alerts (optionally with owner / min_severity) to see what's open and pick repositories.
2. triage_alerts on those repositories. Dependabot goes first: each alert comes back with an action and each repo with ordered nextSteps.
3. review_dependabot_pr → get_dependabot_pr, review it, and merge only if the user has allowed merging; otherwise report it as ready.
   fix_on_pr_branch → check out the Dependabot branch, make CI pass or bump further, push.
   enable_security_updates / rebase_or_recreate_pr → run the gh command given, wait, and triage again.
   manual_fix → manual_fix_prompt for full instructions, then fix it yourself in a branch and open a PR.
   human_decision → ask the user.
4. Finish with a table: repo, alert, what fixed it (Dependabot PR / your PR / pending), links.

These tools never write to GitHub. Do writes yourself with your own git / gh credentials.`;
