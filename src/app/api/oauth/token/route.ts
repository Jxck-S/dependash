/** OAuth token endpoint: authorization_code (with PKCE) and refresh_token. */

import { NextRequest, NextResponse } from 'next/server';
import { unsealTyped } from '@/lib/session';
import {
  AccessGrant,
  CodeGrant,
  cors,
  hostedOnly,
  issueTokens,
  lookupClient,
  oauthError,
  pkceMatches,
} from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function params(req: NextRequest): Promise<URLSearchParams> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await req.text());
}

/** The GitHub grant behind a refresh may have been revoked since. */
async function githubStillValid(token: string): Promise<boolean> {
  const res = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'dependash/1.0' },
    cache: 'no-store',
  });
  return res.ok;
}

export async function POST(req: NextRequest) {
  const blocked = hostedOnly();
  if (blocked) return blocked;
  const p = await params(req);
  const clientId = p.get('client_id');
  if (!lookupClient(clientId)) return oauthError('invalid_client', 'Unknown client_id.', 401);

  const grantType = p.get('grant_type');
  if (grantType === 'authorization_code') {
    const code = unsealTyped<CodeGrant>('code', p.get('code'));
    if (!code || code.cid !== clientId) return oauthError('invalid_grant', 'Code is invalid or expired.');
    if (p.get('redirect_uri') && p.get('redirect_uri') !== code.redirect_uri) {
      return oauthError('invalid_grant', 'redirect_uri does not match.');
    }
    const verifier = p.get('code_verifier');
    if (!verifier || !pkceMatches(verifier, code.challenge)) return oauthError('invalid_grant', 'PKCE verification failed.');
    return cors(NextResponse.json(issueTokens({ gh: code.gh, login: code.login, cid: code.cid }), { headers: { 'cache-control': 'no-store' } }));
  }

  if (grantType === 'refresh_token') {
    const refresh = unsealTyped<AccessGrant>('refresh', p.get('refresh_token'));
    if (!refresh || refresh.cid !== clientId) return oauthError('invalid_grant', 'Refresh token is invalid or expired.');
    if (!(await githubStillValid(refresh.gh))) return oauthError('invalid_grant', 'GitHub access was revoked; sign in again.');
    return cors(NextResponse.json(issueTokens({ gh: refresh.gh, login: refresh.login, cid: refresh.cid }), { headers: { 'cache-control': 'no-store' } }));
  }

  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}
