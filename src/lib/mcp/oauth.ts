/**
 * OAuth 2.1 authorization server for MCP clients, in front of GitHub sign-in.
 *
 * An agent (Claude Code, Claude Desktop, Cursor, …) discovers this server from
 * the 401 on /api/mcp, registers itself (RFC 7591), sends the user through a
 * dependash consent screen and GitHub sign-in, and gets back a bearer token
 * that wraps the user's GitHub token.
 *
 * Still no database: client registrations, authorization codes and tokens are
 * all AES-GCM-sealed blobs (see sealTyped in session.ts), each bound to its
 * kind. Revoking dependash on GitHub (Settings → Applications) kills every
 * token at once, because each one only wraps the GitHub grant.
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appMode } from '../mode';
import { publicOrigin, sealTyped, unsealTyped } from '../session';
import { tokenForRequest } from '../request-token';

export const MCP_SCOPE = 'dependash';
export const CONSENT_COOKIE = 'dependash_mcp_consent';
export const PENDING_COOKIE = 'dependash_mcp_pending';

const now = () => Math.floor(Date.now() / 1000);
export const CODE_TTL = 120;
export const ACCESS_TTL = 24 * 60 * 60;
export const REFRESH_TTL = 90 * 24 * 60 * 60;
/** Tokens copied from the dashboard by hand (no refresh flow). */
export const MANUAL_TTL = 30 * 24 * 60 * 60;
const CLIENT_TTL = 10 * 365 * 24 * 60 * 60;

export interface ClientReg {
  redirect_uris: string[];
  name: string;
  exp: number;
}
export interface PendingAuth {
  cid: string;
  redirect_uri: string;
  /** The client's own `state`, echoed back to it. */
  state: string | null;
  challenge: string;
  /** Ties the consent form and the GitHub round-trip to this browser. */
  nonce: string;
  exp: number;
}
export interface CodeGrant {
  gh: string;
  login: string;
  cid: string;
  redirect_uri: string;
  challenge: string;
  exp: number;
}
export interface AccessGrant {
  gh: string;
  login: string;
  cid: string;
  exp: number;
}

export function resourceUrl(req: NextRequest): string {
  return `${publicOrigin(req)}/api/mcp`;
}

export function protectedResourceMetadata(req: NextRequest) {
  const origin = publicOrigin(req);
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'dependash',
    resource_documentation: `${origin}/agents`,
  };
}

export function authorizationServerMetadata(req: NextRequest) {
  const origin = publicOrigin(req);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    service_documentation: `${origin}/agents`,
  };
}

/* --------------------------- registration -------------------------- */

const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https anywhere, http only on loopback, or a native app's custom scheme. */
export function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || BLOCKED_SCHEMES.has(u.protocol)) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
}

export function registerClient(body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirectUri)) {
    return { ok: false as const, error: 'invalid_redirect_uri', description: 'redirect_uris must be https, loopback http, or an app scheme.' };
  }
  const method = body.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') {
    return { ok: false as const, error: 'invalid_client_metadata', description: 'Only public clients (token_endpoint_auth_method "none") are supported.' };
  }
  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'An MCP client';
  const issued = now();
  const client_id = sealTyped<ClientReg>('client', { redirect_uris: uris as string[], name, exp: issued + CLIENT_TTL });
  return {
    ok: true as const,
    client: {
      client_id,
      client_id_issued_at: issued,
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: MCP_SCOPE,
    },
  };
}

export function lookupClient(clientId: string | null): ClientReg | null {
  return unsealTyped<ClientReg>('client', clientId);
}

/* ------------------------------- PKCE ------------------------------ */

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------ tokens ----------------------------- */

export function mintCode(g: Omit<CodeGrant, 'exp'>): string {
  return sealTyped<CodeGrant>('code', { ...g, exp: now() + CODE_TTL });
}

export function issueTokens(g: { gh: string; login: string; cid: string }) {
  return {
    access_token: sealTyped<AccessGrant>('access', { ...g, exp: now() + ACCESS_TTL }),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: sealTyped<AccessGrant>('refresh', { ...g, exp: now() + REFRESH_TTL }),
    scope: MCP_SCOPE,
  };
}

export function manualToken(g: { gh: string; login: string }): { token: string; expiresAt: string } {
  const exp = now() + MANUAL_TTL;
  return { token: sealTyped<AccessGrant>('access', { ...g, cid: 'dashboard', exp }), expiresAt: new Date(exp * 1000).toISOString() };
}

/* ---------------------------- request auth ------------------------- */

export type McpAuth = { ok: true; token: string; login: string | null } | { ok: false; response: NextResponse };

/**
 * Who is calling /api/mcp?
 *  hosted → a dependash bearer token from the OAuth flow (or the dashboard).
 *  local  → loopback only, using the operator's gh / env token, no sign-in.
 */
export function authenticateMcp(req: NextRequest): McpAuth {
  if (appMode() === 'hosted') {
    const header = req.headers.get('authorization') ?? '';
    const m = header.match(/^Bearer\s+(\S+)$/i);
    const grant = m ? unsealTyped<AccessGrant>('access', m[1]) : null;
    if (grant) return { ok: true, token: grant.gh, login: grant.login };
    const meta = `${publicOrigin(req)}/.well-known/oauth-protected-resource/api/mcp`;
    const res = NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: m ? 'Invalid or expired token.' : 'Sign in required.' } },
      { status: 401 },
    );
    res.headers.set(
      'www-authenticate',
      `Bearer resource_metadata="${meta}", scope="${MCP_SCOPE}"${m ? ', error="invalid_token"' : ''}`,
    );
    return { ok: false, response: res };
  }
  const local = tokenForRequest(req);
  if (!local.ok) {
    return { ok: false, response: NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: local.error } }, { status: local.status }) };
  }
  return { ok: true, token: local.token, login: null };
}

/* ------------------------------ helpers ---------------------------- */

export function cors(res: NextResponse): NextResponse {
  res.headers.set('access-control-allow-origin', '*');
  res.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.headers.set('access-control-allow-headers', 'authorization, content-type, mcp-protocol-version, mcp-session-id');
  res.headers.set('access-control-expose-headers', 'www-authenticate, mcp-session-id');
  res.headers.set('access-control-max-age', '86400');
  return res;
}

export function oauthError(error: string, description: string, status = 400): NextResponse {
  return cors(
    NextResponse.json({ error, error_description: description }, { status, headers: { 'cache-control': 'no-store' } }),
  );
}

export function hostedOnly(): NextResponse | null {
  return appMode() === 'hosted'
    ? null
    : cors(NextResponse.json({ error: 'not_found', error_description: 'OAuth is only used in hosted mode; local mode needs no sign-in.' }, { status: 404 }));
}

/** Redirect back to the MCP client with query params. */
export function redirectToClient(redirectUri: string, params: Record<string, string | null>): NextResponse {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return NextResponse.redirect(u, 303);
}
