/**
 * Read-only GitHub REST client.
 *
 * Hard rule for this project: every request issued here is a GET. There are no
 * POST/PATCH/PUT/DELETE code paths, so the tool physically cannot modify a
 * repository, create a workflow, open a PR, or push a commit.
 */

import { execFileSync } from 'node:child_process';
import {
  AlertRecord,
  AlertState,
  EnablementSource,
  RepoRecord,
  Severity,
  emptySeverityCounts,
} from './types';

const API = 'https://api.github.com';
const UA = 'dependash/1.0 (local-only)';

export interface ClientOptions {
  token: string;
  /** Called with human-readable progress lines. */
  log?: (msg: string) => void;
  /** Max alert pages (100 alerts each) per repo. */
  maxAlertPages?: number;
}

export interface CollectOptions {
  /** Restrict to these owners (users or orgs). Empty = everything visible. */
  owners?: string[];
  /** Skip repos owned by these orgs/users. Applied after `owners`. */
  excludeOwners?: string[];
  /** owner,collaborator,organization_member */
  affiliation?: string;
  includeArchived?: boolean;
  includeForks?: boolean;
  visibility?: 'all' | 'public' | 'private';
  /** Only scan these "owner/name" repos. */
  only?: string[];
  concurrency?: number;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/**
 * Resolve a token without ever storing one in the repo:
 *   1. GITHUB_TOKEN / DEPENDASH_TOKEN / GH_TOKEN env var
 *   2. `gh auth token` from the GitHub CLI keychain
 */
export function resolveToken(explicit?: string): string {
  const fromEnv =
    explicit ||
    process.env.DEPENDASH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  try {
    const out = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (out.trim()) return out.trim();
  } catch {
    /* fall through */
  }

  throw new Error(
    'No GitHub token found. Either run `gh auth login` (recommended) or export ' +
      'GITHUB_TOKEN=<classic PAT with repo + security_events scopes>.',
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GitHubClient {
  private readonly token: string;
  private readonly log: (msg: string) => void;
  private readonly maxAlertPages: number;
  /** Non-fatal problems collected during a run. */
  readonly errors: string[] = [];

  constructor(opts: ClientOptions) {
    this.token = opts.token;
    this.log = opts.log ?? (() => {});
    this.maxAlertPages = opts.maxAlertPages ?? 20;
  }

  private async request(
    path: string,
    init: { accept?: string } = {},
    attempt = 0,
  ): Promise<{ status: number; headers: Headers; body: unknown }> {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const res = await fetch(url, {
      method: 'GET', // read-only, always
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: init.accept ?? 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': UA,
      },
    });

    // Primary rate limit exhausted or secondary rate limit: back off and retry.
    const remaining = res.headers.get('x-ratelimit-remaining');
    const retryAfter = res.headers.get('retry-after');
    if (
      (res.status === 403 || res.status === 429) &&
      (retryAfter || remaining === '0') &&
      attempt < 4
    ) {
      let waitMs = retryAfter ? Number(retryAfter) * 1000 : 0;
      if (!waitMs) {
        const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000;
        waitMs = Math.max(1000, reset - Date.now() + 1000);
      }
      waitMs = Math.min(waitMs, 120_000);
      this.log(`rate limited; waiting ${Math.round(waitMs / 1000)}s …`);
      await sleep(waitMs);
      return this.request(path, init, attempt + 1);
    }

    if (res.status >= 500 && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      return this.request(path, init, attempt + 1);
    }

    let body: unknown = null;
    if (res.status !== 204) {
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
    }
    return { status: res.status, headers: res.headers, body };
  }

  private async get<T>(path: string): Promise<T> {
    const { status, body } = await this.request(path);
    if (status >= 400) {
      const msg =
        (body as { message?: string } | null)?.message ?? `HTTP ${status}`;
      throw new GitHubError(msg, status, path);
    }
    return body as T;
  }

  /** Follow RFC-5988 `link: rel="next"` pagination. */
  private async paginate<T>(path: string, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    let pages = 0;
    while (next && pages < maxPages) {
      const { status, headers, body } = await this.request(next);
      if (status >= 400) {
        const msg =
          (body as { message?: string } | null)?.message ?? `HTTP ${status}`;
        throw new GitHubError(msg, status, next);
      }
      if (Array.isArray(body)) out.push(...(body as T[]));
      next = parseNextLink(headers.get('link'));
      pages += 1;
    }
    return out;
  }

  async viewer(): Promise<string> {
    const user = await this.get<{ login: string }>('/user');
    return user.login;
  }

  async rateLimit(): Promise<{ remaining: number; limit: number }> {
    const rl = await this.get<{
      resources: { core: { remaining: number; limit: number } };
    }>('/rate_limit');
    return rl.resources.core;
  }

  /** Orgs the token's user belongs to (needs `read:org` for private memberships). */
  async listOrgs(): Promise<string[]> {
    const orgs = await this.paginate<{ login: string }>('/user/orgs?per_page=100');
    return orgs.map((o) => o.login);
  }

  /** List repositories visible to the token. */
  async listRepos(opts: CollectOptions): Promise<RawRepo[]> {
    const affiliation = opts.affiliation ?? 'owner,collaborator,organization_member';
    const visibility = opts.visibility ?? 'all';
    let repos: RawRepo[] = [];

    if (opts.owners?.length) {
      for (const owner of opts.owners) {
        // Try the org endpoint first, fall back to the user endpoint.
        try {
          repos.push(
            ...(await this.paginate<RawRepo>(
              `/orgs/${owner}/repos?per_page=100&type=all&sort=full_name`,
            )),
          );
        } catch (err) {
          if (err instanceof GitHubError && (err.status === 404 || err.status === 403)) {
            repos.push(
              ...(await this.paginate<RawRepo>(
                `/users/${owner}/repos?per_page=100&type=owner&sort=full_name`,
              )),
            );
          } else {
            throw err;
          }
        }
      }
    } else {
      repos = await this.paginate<RawRepo>(
        `/user/repos?per_page=100&affiliation=${encodeURIComponent(
          affiliation,
        )}&visibility=${visibility}&sort=full_name`,
      );
    }

    // De-dupe (a repo can appear via several affiliations).
    const seen = new Map<string, RawRepo>();
    for (const r of repos) seen.set(r.full_name.toLowerCase(), r);
    let list = [...seen.values()];

    if (opts.only?.length) {
      const wanted = new Set(opts.only.map((s) => s.toLowerCase()));
      list = list.filter((r) => wanted.has(r.full_name.toLowerCase()));
    }
    if (opts.excludeOwners?.length) {
      const skip = new Set(opts.excludeOwners.map((s) => s.toLowerCase()));
      const before = list.length;
      list = list.filter((r) => !skip.has(r.owner.login.toLowerCase()));
      this.log(`excluded ${before - list.length} repos from ${[...skip].join(', ')}`);
    }
    if (!opts.includeArchived) list = list.filter((r) => !r.archived);
    if (!opts.includeForks) list = list.filter((r) => !r.fork);
    list = list.filter((r) => !r.disabled);

    return list.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  /**
   * Determine whether Dependabot alerts are enabled.
   * GET /repos/{o}/{r}/vulnerability-alerts → 204 enabled, 404 disabled,
   * 403 means the token lacks admin rights on that repo (we then infer from
   * the alerts endpoint instead).
   */
  async checkEnablement(
    repo: RawRepo,
  ): Promise<{ enabled: boolean | null; source: EnablementSource }> {
    const sa = repo.security_and_analysis;
    if (sa?.dependabot_security_updates?.status) {
      // Only returned to repo admins; a reliable signal when present.
      if (sa.dependabot_security_updates.status === 'enabled') {
        return { enabled: true, source: 'security-and-analysis' };
      }
    }
    const { status } = await this.request(
      `/repos/${repo.full_name}/vulnerability-alerts`,
    );
    if (status === 204) return { enabled: true, source: 'vulnerability-alerts-api' };
    if (status === 404) return { enabled: false, source: 'vulnerability-alerts-api' };
    return { enabled: null, source: 'unknown' };
  }

  /** Fetch every Dependabot alert (all states) for a repo. */
  async listAlerts(
    fullName: string,
  ): Promise<{
    alerts: RawAlert[];
    enabled: boolean | null;
    error?: string;
    archived?: boolean;
  }> {
    try {
      const alerts = await this.paginate<RawAlert>(
        `/repos/${fullName}/dependabot/alerts?per_page=100&state=open,fixed,dismissed,auto_dismissed`,
        this.maxAlertPages,
      );
      return { alerts, enabled: true };
    } catch (err) {
      if (err instanceof GitHubError) {
        // GitHub refuses alert reads on archived repos. That's expected, not a
        // failure, so it must not be reported as a collection warning.
        if (err.status === 403 && /archived/i.test(err.message)) {
          return { alerts: [], enabled: null, archived: true };
        }
        if (err.status === 403 && /disabled/i.test(err.message)) {
          return { alerts: [], enabled: false };
        }
        if (err.status === 404) {
          return { alerts: [], enabled: null, error: `${fullName}: no access to alerts (404)` };
        }
        return { alerts: [], enabled: null, error: `${fullName}: ${err.message}` };
      }
      throw err;
    }
  }

  /** Collect repos + alerts for the whole account. */
  async collect(
    opts: CollectOptions,
  ): Promise<{ repos: RepoRecord[]; alerts: AlertRecord[] }> {
    const raw = await this.listRepos(opts);
    this.log(`found ${raw.length} repositories`);

    const repos: RepoRecord[] = [];
    const alerts: AlertRecord[] = [];
    let done = 0;

    await mapWithConcurrency(raw, opts.concurrency ?? 6, async (repo) => {
      const record = baseRepoRecord(repo);
      try {
        const alertResult = await this.listAlerts(repo.full_name);
        if (alertResult.error) {
          record.error = alertResult.error;
          this.errors.push(alertResult.error);
        }

        if (alertResult.enabled === true) {
          record.dependabotAlertsEnabled = true;
          record.enablementSource = 'alerts-api-ok';
        } else if (alertResult.enabled === false) {
          record.dependabotAlertsEnabled = false;
          record.enablementSource = 'alerts-api-403';
        } else if (alertResult.archived) {
          // Archived repos can't be scanned by Dependabot at all.
          record.dependabotAlertsEnabled = null;
          record.enablementSource = 'archived';
        } else {
          const probe = await this.checkEnablement(repo).catch(() => ({
            enabled: null as boolean | null,
            source: 'unknown' as EnablementSource,
          }));
          record.dependabotAlertsEnabled = probe.enabled;
          record.enablementSource = probe.source;
        }

        const sa = repo.security_and_analysis?.dependabot_security_updates?.status;
        record.dependabotSecurityUpdatesEnabled =
          sa === 'enabled' ? true : sa === 'disabled' ? false : null;

        for (const a of alertResult.alerts) {
          const normalized = normalizeAlert(repo.full_name, a);
          alerts.push(normalized);
          if (normalized.state === 'open') {
            record.openAlerts += 1;
            record.openBySeverity[normalized.severity] += 1;
          } else if (normalized.state === 'fixed') {
            record.fixedAlerts += 1;
          } else {
            record.dismissedAlerts += 1;
          }
        }
      } catch (err) {
        const msg = `${repo.full_name}: ${(err as Error).message}`;
        record.error = msg;
        this.errors.push(msg);
      }
      repos.push(record);
      done += 1;
      if (done % 10 === 0 || done === raw.length) {
        this.log(`  scanned ${done}/${raw.length}`);
      }
    });

    repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
    alerts.sort((a, b) => a.key.localeCompare(b.key));
    return { repos, alerts };
  }
}

/* ------------------------------ helpers ------------------------------ */

export interface RawRepo {
  full_name: string;
  name: string;
  owner: { login: string; type?: 'User' | 'Organization' };
  private: boolean;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  html_url: string;
  security_and_analysis?: {
    dependabot_security_updates?: { status: 'enabled' | 'disabled' };
  } | null;
}

export interface RawAlert {
  number: number;
  state: AlertState;
  html_url: string;
  created_at: string;
  updated_at: string;
  fixed_at: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  dependency: {
    package?: { ecosystem: string; name: string };
    manifest_path?: string;
    scope?: 'development' | 'runtime' | null;
  };
  security_advisory: {
    ghsa_id: string;
    cve_id: string | null;
    summary: string;
    severity: Severity;
    cvss?: { score: number | null } | null;
    identifiers?: { type: string; value: string }[];
  };
  security_vulnerability: {
    severity: Severity;
    vulnerable_version_range: string;
    first_patched_version: { identifier: string } | null;
    package?: { ecosystem: string; name: string };
  };
}

function baseRepoRecord(repo: RawRepo): RepoRecord {
  return {
    fullName: repo.full_name,
    owner: repo.owner.login,
    ownerType: repo.owner.type ?? null,
    name: repo.name,
    private: repo.private,
    archived: repo.archived,
    fork: repo.fork,
    disabled: repo.disabled,
    defaultBranch: repo.default_branch,
    language: repo.language,
    stars: repo.stargazers_count,
    pushedAt: repo.pushed_at,
    htmlUrl: repo.html_url,
    dependabotUrl: `https://github.com/${repo.full_name}/security/dependabot`,
    dependabotAlertsEnabled: null,
    dependabotSecurityUpdatesEnabled: null,
    enablementSource: 'unknown',
    error: null,
    openAlerts: 0,
    openBySeverity: emptySeverityCounts(),
    fixedAlerts: 0,
    dismissedAlerts: 0,
  };
}

export function normalizeAlert(fullName: string, a: RawAlert): AlertRecord {
  const pkg = a.security_vulnerability?.package ?? a.dependency?.package;
  const ghsa = a.security_advisory?.ghsa_id ?? null;
  const severity: Severity =
    a.security_vulnerability?.severity ?? a.security_advisory?.severity ?? 'low';
  return {
    key: `${fullName}#${a.number}`,
    repo: fullName,
    number: a.number,
    state: a.state,
    severity,
    ghsaId: ghsa,
    cveId: a.security_advisory?.cve_id ?? null,
    summary: a.security_advisory?.summary ?? '',
    cvssScore: a.security_advisory?.cvss?.score ?? null,
    ecosystem: pkg?.ecosystem ?? 'unknown',
    packageName: pkg?.name ?? 'unknown',
    manifestPath: a.dependency?.manifest_path ?? null,
    vulnerableVersionRange: a.security_vulnerability?.vulnerable_version_range ?? null,
    firstPatchedVersion: a.security_vulnerability?.first_patched_version?.identifier ?? null,
    scope: a.dependency?.scope ?? null,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    fixedAt: a.fixed_at,
    dismissedAt: a.dismissed_at,
    dismissedReason: a.dismissed_reason,
    htmlUrl: a.html_url,
    advisoryUrl: ghsa ? `https://github.com/advisories/${ghsa}` : null,
  };
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}
