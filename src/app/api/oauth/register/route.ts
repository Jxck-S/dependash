/** RFC 7591 dynamic client registration. Stateless: the client id is sealed. */

import { NextRequest, NextResponse } from 'next/server';
import { cors, hostedOnly, oauthError, registerClient } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const blocked = hostedOnly();
  if (blocked) return blocked;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return oauthError('invalid_client_metadata', 'Expected a JSON body.');
  const result = registerClient(body);
  if (!result.ok) return oauthError(result.error, result.description);
  return cors(NextResponse.json(result.client, { status: 201, headers: { 'cache-control': 'no-store' } }));
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}
