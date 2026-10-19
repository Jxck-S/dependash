/**
 * Hosted-mode session: the user's GitHub OAuth token, sealed into an
 * HttpOnly cookie with AES-256-GCM. No database — the cookie *is* the session,
 * and page JavaScript can never read it.
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE = 'dependash_session';
export const STATE_COOKIE = 'dependash_oauth_state';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const OAUTH_SCOPES = 'repo security_events read:org';

export interface Session {
  /** GitHub OAuth access token. */
  token: string;
  login: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

export function oauthConfig(): OAuthConfig {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in hosted mode.');
  }
  return { clientId, clientSecret };
}

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function sealSession(session: Session): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unsealSession(sealed: string | undefined): Session | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const session = JSON.parse(json) as Session;
    if (typeof session.token !== 'string' || session.exp * 1000 < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function getSession(req: NextRequest): Session | null {
  return unsealSession(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Secure cookies everywhere except plain-http localhost testing. */
function secure(req: NextRequest): boolean {
  return req.nextUrl.protocol === 'https:';
}

export function setSessionCookie(res: NextResponse, req: NextRequest, session: Session): void {
  res.cookies.set(SESSION_COOKIE, sealSession(session), {
    httpOnly: true,
    secure: secure(req),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function setStateCookie(res: NextResponse, req: NextRequest, state: string): void {
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: secure(req),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 10 * 60,
  });
}

export function clearCookie(res: NextResponse, name: string, path = '/'): void {
  res.cookies.set(name, '', { path, maxAge: 0 });
}

/** Public origin of this deployment, for the OAuth redirect URI. */
export function publicOrigin(req: NextRequest): string {
  return process.env.DEPENDASH_URL?.replace(/\/+$/, '') ?? req.nextUrl.origin;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
