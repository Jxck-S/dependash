/**
 * Hosted mode: GitHub redirects here after the user authorizes.
 * Verifies `state`, exchanges the code for a token (the one server-to-GitHub
 * POST in the app — it goes to github.com's OAuth endpoint, not to any
 * repository), and stores the token in the sealed session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appMode } from '@/lib/mode';
import {
  SESSION_TTL_SECONDS,
  STATE_COOKIE,
  clearCookie,
  oauthConfig,
  publicOrigin,
  setSessionCookie,
  timingSafeEqual,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(req: NextRequest, reason: string): NextResponse {
  const res = NextResponse.redirect(`${publicOrigin(req)}/?auth_error=${encodeURIComponent(reason)}`);
  clearCookie(res, STATE_COOKIE, '/api/auth');
  return res;
}

export async function GET(req: NextRequest) {
  if (appMode() !== 'hosted') {
    return NextResponse.json({ error: 'Sign-in is only used in hosted mode.' }, { status: 404 });
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  if (req.nextUrl.searchParams.get('error')) return fail(req, 'access_denied');
  if (!code || !state || !expected || !timingSafeEqual(state, expected)) {
    return fail(req, 'invalid_state');
  }

  const { clientId, clientSecret } = oauthConfig();
  const exchange = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${publicOrigin(req)}/api/auth/callback`,
    }),
    cache: 'no-store',
  });
  const grant = (await exchange.json().catch(() => ({}))) as { access_token?: string };
  if (!exchange.ok || !grant.access_token) return fail(req, 'token_exchange_failed');

  const user = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${grant.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dependash/1.0',
    },
    cache: 'no-store',
  });
  const profile = (await user.json().catch(() => ({}))) as { login?: string };
  if (!user.ok || !profile.login) return fail(req, 'profile_failed');

  const res = NextResponse.redirect(`${publicOrigin(req)}/`);
  clearCookie(res, STATE_COOKIE, '/api/auth');
  setSessionCookie(res, req, {
    token: grant.access_token,
    login: profile.login,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  return res;
}
