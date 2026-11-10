/**
 * OAuth authorize endpoint for MCP clients.
 *
 * GET  validates the request and shows a consent screen naming the client and
 *      where it will send the user back to. Dynamically registered clients can
 *      be anyone, so consent is never skipped — even for a signed-in user who
 *      has already authorized dependash on GitHub.
 * POST (the consent form) either reuses the dashboard session or bounces
 *      through GitHub sign-in, then redirects to the client with a code.
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  OAUTH_SCOPES,
  getSession,
  oauthConfig,
  publicOrigin,
  sealTyped,
  timingSafeEqual,
  unsealTyped,
} from '@/lib/session';
import {
  CONSENT_COOKIE,
  PENDING_COOKIE,
  PendingAuth,
  hostedOnly,
  lookupClient,
  mintCode,
  redirectToClient,
  resourceUrl,
} from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(status: number, title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · dependash</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#14171c;--muted:#5b6472;--line:#dfe3e8;--accent:#2f6fed;--accent-fg:#fff;--warn:#9a5b00}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--accent:#4c8dff;--accent-fg:#0d1117;--warn:#d29922}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;max-width:440px;width:100%;padding:28px}
h1{font-size:19px;margin:0 0 12px}p{margin:0 0 12px;color:var(--muted)}b,code{color:var(--fg)}code{font-size:13px;word-break:break-all}
ul{margin:0 0 16px;padding-left:20px;color:var(--muted)}.warn{color:var(--warn)}
.row{display:flex;gap:10px;margin-top:20px}button{flex:1;font:inherit;padding:10px 14px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);font-weight:600}
</style></head><body><main class="card">${body}</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" },
  });
}

function problem(message: string): NextResponse {
  return page(400, 'Can’t connect', `<h1>This connection request isn’t valid</h1><p>${esc(message)}</p>`);
}

export async function GET(req: NextRequest) {
  const blocked = hostedOnly();
  if (blocked) return blocked;
  const q = req.nextUrl.searchParams;
  const clientId = q.get('client_id');
  const client = lookupClient(clientId);
  if (!client || !clientId) return problem('Unknown client. Remove and re-add the dependash connection in your agent.');
  const redirectUri = q.get('redirect_uri') ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : null);
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return problem('redirect_uri does not match this client’s registration.');

  // From here on, errors go back to the (now verified) client.
  const state = q.get('state');
  if (q.get('response_type') !== 'code') return redirectToClient(redirectUri, { error: 'unsupported_response_type', state });
  const challenge = q.get('code_challenge');
  if (!challenge || q.get('code_challenge_method') !== 'S256') {
    return redirectToClient(redirectUri, { error: 'invalid_request', error_description: 'PKCE with S256 is required.', state });
  }
  const resource = q.get('resource');
  if (resource && resource.replace(/\/+$/, '') !== resourceUrl(req)) {
    return redirectToClient(redirectUri, { error: 'invalid_target', error_description: 'Unknown resource.', state });
  }

  const nonce = crypto.randomBytes(18).toString('base64url');
  const pending = sealTyped<PendingAuth>('consent', {
    cid: clientId,
    redirect_uri: redirectUri,
    state,
    challenge,
    nonce,
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const session = getSession(req);
  const dest = new URL(redirectUri);
  const destLabel = dest.protocol === 'https:' || dest.protocol === 'http:' ? dest.host : `${dest.protocol}//${dest.host}`;

  const res = page(
    200,
    'Connect an agent',
    `<h1>Connect <b>${esc(client.name)}</b> to dependash?</h1>
<p>It will be able to <b>read</b>, as ${session ? `<b>@${esc(session.login)}</b>` : 'your GitHub account'}:</p>
<ul><li>Dependabot alerts on every repository you can see</li><li>Dependabot pull requests, their diffs and CI results</li><li>Whether Dependabot security updates are on</li></ul>
<p>dependash itself never writes to GitHub. The agent does its fixes with its own git/gh access.</p>
<p class="warn">After you approve, you’ll be sent to <code>${esc(destLabel)}</code>. Only continue if you just added dependash to an agent yourself.</p>
<form method="post" action="/api/oauth/authorize">
<input type="hidden" name="request" value="${esc(pending)}">
<div class="row"><button type="submit" name="decision" value="deny">Cancel</button><button class="primary" type="submit" name="decision" value="allow">${session ? 'Allow' : 'Continue with GitHub'}</button></div>
</form>`,
  );
  // Lax: sent with our own form's POST, never with a cross-site one.
  res.cookies.set(CONSENT_COOKIE, nonce, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/oauth/authorize',
    maxAge: 600,
  });
  return res;
}

export async function POST(req: NextRequest) {
  const blocked = hostedOnly();
  if (blocked) return blocked;
  const form = await req.formData().catch(() => null);
  const pending = unsealTyped<PendingAuth>('consent', form?.get('request')?.toString());
  const cookie = req.cookies.get(CONSENT_COOKIE)?.value;
  if (!pending || !cookie || !timingSafeEqual(cookie, pending.nonce) || !lookupClient(pending.cid)) {
    return problem('This request expired or didn’t come from this browser. Start the connection from your agent again.');
  }
  if (form?.get('decision') !== 'allow') {
    return redirectToClient(pending.redirect_uri, { error: 'access_denied', state: pending.state });
  }

  // Already signed in to the dashboard: no need to go through GitHub again.
  const session = getSession(req);
  if (session) {
    const code = mintCode({ gh: session.token, login: session.login, cid: pending.cid, redirect_uri: pending.redirect_uri, challenge: pending.challenge });
    const res = redirectToClient(pending.redirect_uri, { code, state: pending.state, iss: publicOrigin(req) });
    res.cookies.set(CONSENT_COOKIE, '', { path: '/api/oauth/authorize', maxAge: 0 });
    return res;
  }

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', oauthConfig().clientId);
  authorize.searchParams.set('redirect_uri', `${publicOrigin(req)}/api/auth/callback/mcp`);
  authorize.searchParams.set('scope', OAUTH_SCOPES);
  authorize.searchParams.set('state', pending.nonce);
  authorize.searchParams.set('allow_signup', 'false');
  const res = NextResponse.redirect(authorize, 303);
  res.cookies.set(CONSENT_COOKIE, '', { path: '/api/oauth/authorize', maxAge: 0 });
  res.cookies.set(PENDING_COOKIE, form!.get('request')!.toString(), {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/auth/callback/mcp',
    maxAge: 600,
  });
  return res;
}
