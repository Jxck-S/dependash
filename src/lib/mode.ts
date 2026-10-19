/**
 * Which way this deployment authenticates to GitHub (server only).
 *
 *  - local:  one user — whoever runs the server. The token comes from
 *            $GITHUB_TOKEN etc. or `gh auth token`, and every API route
 *            answers loopback requests only.
 *  - hosted: many users, each signed in with GitHub OAuth. The token comes
 *            from that user's encrypted session cookie, never from the
 *            server's environment.
 *
 * Defaults to hosted when an OAuth App is configured; DEPENDASH_MODE overrides.
 */

import { NextRequest } from 'next/server';

export type AppMode = 'local' | 'hosted';

export function appMode(): AppMode {
  const explicit = process.env.DEPENDASH_MODE;
  if (explicit === 'local' || explicit === 'hosted') return explicit;
  return process.env.GITHUB_CLIENT_ID ? 'hosted' : 'local';
}

/** Only allow requests originating from this machine (local mode). */
export function isLocalRequest(req: NextRequest): boolean {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const allowed = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];
  if (allowed.includes(host)) return true;
  // Allow an explicit opt-in when self-hosting behind your own auth.
  return process.env.DEPENDASH_ALLOW_REMOTE_RUN === '1';
}
