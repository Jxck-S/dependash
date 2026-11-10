/**
 * Mint an MCP bearer token from the signed-in dashboard session, for agents
 * that take a static `Authorization` header instead of doing OAuth.
 * POST + the x-dependash header, so a cross-site page can't trigger it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PROXY_HEADER } from '@/lib/github';
import { appMode } from '@/lib/mode';
import { getSession } from '@/lib/session';
import { manualToken } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (appMode() !== 'hosted') {
    return NextResponse.json({ error: 'Local mode needs no token: the MCP endpoint uses your gh login.' }, { status: 404 });
  }
  if (req.headers.get(PROXY_HEADER) !== '1') return NextResponse.json({ error: 'Missing header.' }, { status: 403 });
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  return NextResponse.json(manualToken({ gh: session.token, login: session.login }), { headers: { 'cache-control': 'no-store' } });
}
