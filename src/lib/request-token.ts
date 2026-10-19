/**
 * Which GitHub token serves a given request (server only).
 *
 * hosted → the signed-in user's token from their session cookie, or nothing.
 *          The server's own environment is never consulted, so one user can
 *          never act with another's (or the operator's) token.
 * local  → loopback requests only, using $GITHUB_TOKEN etc. or `gh auth token`.
 */

import { NextRequest } from 'next/server';
import { appMode, isLocalRequest } from './mode';
import { getSession } from './session';
import { resolveToken } from './token';

export type RequestToken =
  | { ok: true; token: string }
  | { ok: false; status: number; error: string };

// `gh auth token` spawns a process; a fetch makes hundreds of proxied calls.
let cached: { token: string; at: number } | null = null;
const CACHE_MS = 5 * 60_000;

function localToken(): string {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.token;
  cached = { token: resolveToken(), at: Date.now() };
  return cached.token;
}

export function tokenForRequest(req: NextRequest): RequestToken {
  if (appMode() === 'hosted') {
    const session = getSession(req);
    return session
      ? { ok: true, token: session.token }
      : { ok: false, status: 401, error: 'Not signed in.' };
  }
  if (!isLocalRequest(req)) {
    return { ok: false, status: 403, error: 'Local requests only.' };
  }
  try {
    return { ok: true, token: localToken() };
  } catch (err) {
    return { ok: false, status: 401, error: (err as Error).message };
  }
}
