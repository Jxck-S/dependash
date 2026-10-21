/**
 * Hosted mode: sign out. Revokes the OAuth token on GitHub (so it is dead
 * everywhere, not just in this browser) and clears the session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appMode } from '@/lib/mode';
import { SESSION_COOKIE, clearCookie, getSession, oauthConfig, publicOrigin } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (appMode() !== 'hosted') {
    return NextResponse.json({ error: 'Sign-out is only used in hosted mode.' }, { status: 404 });
  }
  // Only our own page may sign the user out.
  const origin = req.headers.get('origin');
  if (origin && origin !== publicOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request refused.' }, { status: 403 });
  }

  const session = getSession(req);
  if (session) {
    const { clientId, clientSecret } = oauthConfig();
    // Revokes only this app's token for this user; touches no repository.
    await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: 'DELETE',
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'dependash/1.0',
      },
      body: JSON.stringify({ access_token: session.token }),
      cache: 'no-store',
    }).catch(() => {
      /* best effort — the cookie is cleared regardless */
    });
  }

  const res = NextResponse.json({ signedOut: true });
  clearCookie(res, SESSION_COOKIE);
  return res;
}
