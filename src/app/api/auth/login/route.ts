/**
 * Hosted mode: start the GitHub OAuth web flow.
 * Sets a short-lived anti-CSRF `state` cookie and redirects to GitHub.
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appMode } from '@/lib/mode';
import { OAUTH_SCOPES, oauthConfig, publicOrigin, setStateCookie } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (appMode() !== 'hosted') {
    return NextResponse.json({ error: 'Sign-in is only used in hosted mode.' }, { status: 404 });
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', oauthConfig().clientId);
  authorize.searchParams.set('redirect_uri', `${publicOrigin(req)}/api/auth/callback`);
  authorize.searchParams.set('scope', OAUTH_SCOPES);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'false');

  const res = NextResponse.redirect(authorize);
  setStateCookie(res, req, state);
  return res;
}
