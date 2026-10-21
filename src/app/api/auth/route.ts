/**
 * Reports the app mode and how the dashboard is authenticating to GitHub,
 * without ever returning the token itself.
 */

import { NextRequest, NextResponse } from 'next/server';
import { GitHubClient } from '@/lib/github';
import { appMode, isLocalRequest } from '@/lib/mode';
import { getSession } from '@/lib/session';
import { detectTokenSource, resolveToken } from '@/lib/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const mode = appMode();

  if (mode === 'hosted') {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ mode, authenticated: false, source: 'oauth', detail: 'not signed in' });
    }
    try {
      const rate = await new GitHubClient({ token: session.token }).rateLimit();
      return NextResponse.json({
        mode,
        authenticated: true,
        viewer: session.login,
        source: 'oauth',
        detail: 'GitHub sign-in',
        rateLimit: rate,
      });
    } catch (err) {
      // Token revoked on GitHub's side: treat as signed out.
      return NextResponse.json({
        mode,
        authenticated: false,
        source: 'oauth',
        detail: 'session expired',
        error: (err as Error).message,
      });
    }
  }

  if (!isLocalRequest(req)) {
    return NextResponse.json({ error: 'Local requests only.' }, { status: 403 });
  }

  const { source, detail } = detectTokenSource();
  if (source === 'none') {
    return NextResponse.json({
      mode,
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
      mode,
      authenticated: true,
      viewer,
      source,
      detail,
      rateLimit: rate,
    });
  } catch (err) {
    return NextResponse.json({
      mode,
      authenticated: false,
      source,
      detail,
      error: (err as Error).message,
    });
  }
}
