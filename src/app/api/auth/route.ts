/**
 * Reports how the dashboard is authenticating to GitHub, without ever
 * returning the token itself.
 */

import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'node:child_process';
import { GitHubClient, resolveToken } from '@/lib/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isLocal(req: NextRequest): boolean {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  return ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(host)
    || process.env.DEPENDASH_ALLOW_REMOTE_RUN === '1';
}

function detectSource(): { source: string; detail: string } {
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

export async function GET(req: NextRequest) {
  if (!isLocal(req)) {
    return NextResponse.json({ error: 'Local requests only.' }, { status: 403 });
  }

  const { source, detail } = detectSource();
  if (source === 'none') {
    return NextResponse.json({
      authenticated: false,
      source,
      detail,
      hint: 'Run `gh auth login`, or export GITHUB_TOKEN=<PAT with repo + security_events>.',
    });
  }

  try {
    const client = new GitHubClient({ token: resolveToken() });
    const viewer = await client.viewer();
    const rate = await client.rateLimit();
    return NextResponse.json({
      authenticated: true,
      viewer,
      source,
      detail,
      transport: 'native fetch() → https://api.github.com (GET only)',
      rateLimit: rate,
    });
  } catch (err) {
    return NextResponse.json({
      authenticated: false,
      source,
      detail,
      error: (err as Error).message,
    });
  }
}
