/**
 * GitHub sign-in callback for the MCP OAuth flow. (A sub-path of the main
 * callback, so the same GitHub OAuth App's callback URL covers it.)
 * Exchanges GitHub's code for a token, then redirects to the MCP client with
 * a short-lived, PKCE-bound dependash authorization code.
 */

import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig, publicOrigin, timingSafeEqual, unsealTyped } from '@/lib/session';
import { PENDING_COOKIE, PendingAuth, hostedOnly, mintCode, redirectToClient } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clear(res: NextResponse): NextResponse {
  res.cookies.set(PENDING_COOKIE, '', { path: '/api/auth/callback/mcp', maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const blocked = hostedOnly();
  if (blocked) return blocked;
  const pending = unsealTyped<PendingAuth>('consent', req.cookies.get(PENDING_COOKIE)?.value);
  const state = req.nextUrl.searchParams.get('state');
  if (!pending || !state || !timingSafeEqual(state, pending.nonce)) {
    return clear(NextResponse.json({ error: 'Sign-in expired or came from another browser. Reconnect from your agent.' }, { status: 400 }));
  }
  const back = (params: Record<string, string | null>) => clear(redirectToClient(pending.redirect_uri, { ...params, state: pending.state }));

  const code = req.nextUrl.searchParams.get('code');
  if (req.nextUrl.searchParams.get('error') || !code) return back({ error: 'access_denied' });

  const { clientId, clientSecret } = oauthConfig();
  const exchange = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: `${publicOrigin(req)}/api/auth/callback/mcp` }),
    cache: 'no-store',
  });
  const grant = (await exchange.json().catch(() => ({}))) as { access_token?: string };
  if (!exchange.ok || !grant.access_token) return back({ error: 'server_error', error_description: 'GitHub token exchange failed.' });

  const user = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${grant.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'dependash/1.0' },
    cache: 'no-store',
  });
  const profile = (await user.json().catch(() => ({}))) as { login?: string };
  if (!user.ok || !profile.login) return back({ error: 'server_error', error_description: 'Could not read GitHub profile.' });

  const dependashCode = mintCode({
    gh: grant.access_token,
    login: profile.login,
    cid: pending.cid,
    redirect_uri: pending.redirect_uri,
    challenge: pending.challenge,
  });
  return back({ code: dependashCode, iss: publicOrigin(req) });
}
