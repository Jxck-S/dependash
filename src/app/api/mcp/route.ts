/**
 * MCP endpoint for AI agents (Streamable HTTP, stateless, read-only).
 *
 *   hosted: claude mcp add --transport http dependash https://<host>/api/mcp
 *           → the client gets a 401, discovers our OAuth server and signs in.
 *   local:  claude mcp add --transport http dependash http://localhost:3939/api/mcp
 *           → loopback only, uses your gh token, no sign-in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { GitHubClient } from '@/lib/github';
import { appMode } from '@/lib/mode';
import { PROTOCOL_VERSIONS, handleMessage, parseBody } from '@/lib/mcp/server';
import { authenticateMcp, cors } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A whole-account list_open_alerts scan makes a few hundred GitHub calls.
export const maxDuration = 300;

function finish(res: NextResponse): NextResponse {
  res.headers.set('cache-control', 'no-store');
  return appMode() === 'hosted' ? cors(res) : res;
}

export async function POST(req: NextRequest) {
  // Local mode: refuse browser pages on other origins (DNS rebinding / CSRF
  // against localhost). Hosted mode is bearer-authenticated, so CORS is fine.
  if (appMode() === 'local') {
    const origin = req.headers.get('origin');
    if (origin && origin !== req.nextUrl.origin) {
      return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
    }
  }
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    return finish(NextResponse.json({ error: 'Content-Type must be application/json.' }, { status: 415 }));
  }

  const auth = authenticateMcp(req);
  if (!auth.ok) return finish(auth.response);

  const parsed = parseBody(await req.text());
  if (!parsed.ok) return finish(NextResponse.json(parsed.response, { status: 400 }));

  const version = req.headers.get('mcp-protocol-version');
  const response = await handleMessage(
    parsed.msg,
    async () => ({ gh: new GitHubClient({ token: auth.token }), login: auth.login }),
    version && PROTOCOL_VERSIONS.includes(version) ? version : PROTOCOL_VERSIONS[0],
  );
  if (!response) return finish(new NextResponse(null, { status: 202 }));
  return finish(NextResponse.json(response));
}

/** No server-initiated stream: this server only answers requests. */
export async function GET() {
  return finish(new NextResponse(null, { status: 405, headers: { allow: 'POST' } }));
}

export async function DELETE() {
  return finish(new NextResponse(null, { status: 405, headers: { allow: 'POST' } }));
}

export async function OPTIONS() {
  return finish(new NextResponse(null, { status: 204 }));
}
