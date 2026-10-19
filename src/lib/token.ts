/**
 * Local-mode token lookup (Node only — never bundled into the browser).
 *
 * Hosted mode never calls this: there, every request uses the signed-in
 * user's OAuth token from their session cookie. See mode.ts.
 */

import { execFileSync } from 'node:child_process';

export type TokenSource = { source: 'env' | 'gh-cli' | 'none'; detail: string };

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

/** Where resolveToken() would get its token from, without returning it. */
export function detectTokenSource(): TokenSource {
  if (process.env.DEPENDASH_TOKEN) return { source: 'env', detail: '$DEPENDASH_TOKEN' };
  if (process.env.GITHUB_TOKEN) return { source: 'env', detail: '$GITHUB_TOKEN' };
  if (process.env.GH_TOKEN) return { source: 'env', detail: '$GH_TOKEN' };
  try {
    execFileSync('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return { source: 'gh-cli', detail: 'gh auth token (GitHub CLI keychain)' };
  } catch {
    return { source: 'none', detail: 'no token found' };
  }
}
