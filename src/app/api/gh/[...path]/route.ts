/**
 * Read-only GitHub API proxy used by the dashboard in the browser.
 *
 * The browser runs the whole fetch loop; each call lands here, gets the right
 * token attached server-side (see request-token.ts), and is forwarded to
 * api.github.com. That keeps the token out of page JavaScript and keeps every
 * serverless invocation short (one GitHub request each).
 *
 * Safety properties:
 *  - Exports GET only: there is no way to send a write through this route.
 *  - Path allowlist: only the endpoints the collector actually reads.
 *  - Requires the x-dependash header, which our page sets and a cross-site
 *    link, image or form cannot.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PROXY_HEADER } from '@/lib/github';
import { tokenForRequest } from '@/lib/request-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API = 'https://api.github.com';
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const ALLOWED: RegExp[] = [
  /^\/user$/,
  /^\/user\/repos$/,
  /^\/user\/orgs$/,
  /^\/rate_limit$/,
  /^\/orgs\/[^/]+\/repos$/,
  /^\/users\/[^/]+\/repos$/,
  /^\/repos\/[^/]+\/[^/]+\/vulnerability-alerts$/,
  /^\/repos\/[^/]+\/[^/]+\/dependabot\/alerts$/,
];
const PASS_HEADERS = [
  'content-type',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'retry-after',
];

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (req.headers.get(PROXY_HEADER) !== '1') {
    return NextResponse.json({ message: 'Missing proxy header.' }, { status: 403 });
  }

  const segments = (await params).path;
  if (!segments.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..')) {
    return NextResponse.json({ message: 'Invalid path.' }, { status: 400 });
  }
  const apiPath = `/${segments.join('/')}`;
  if (!ALLOWED.some((re) => re.test(apiPath))) {
    return NextResponse.json({ message: `Endpoint not allowed: ${apiPath}` }, { status: 403 });
  }

  const auth = tokenForRequest(req);
  if (!auth.ok) return NextResponse.json({ message: auth.error }, { status: auth.status });

  const upstream = await fetch(`${API}${apiPath}${req.nextUrl.search}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${auth.token}`,
      accept: req.headers.get('accept') ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dependash/1.0',
    },
    cache: 'no-store',
  });

  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Pagination links point at api.github.com; make them API-relative so the
  // client keeps routing them through this proxy.
  const link = upstream.headers.get('link');
  if (link) headers.set('link', link.split(API).join(''));

  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new NextResponse(body, { status: upstream.status, headers });
}
