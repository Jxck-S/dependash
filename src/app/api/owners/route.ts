/**
 * Owners that can be skipped in a fetch: the viewer's orgs from GitHub, plus
 * any other owner seen in the last fetch (e.g. collaborator repos).
 */

import { NextRequest, NextResponse } from 'next/server';
import { GitHubClient, resolveToken } from '@/lib/github';
import { readSnapshot } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isLocal(req: NextRequest): boolean {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  return ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(host)
    || process.env.DEPENDASH_ALLOW_REMOTE_RUN === '1';
}

interface OwnerEntry {
  login: string;
  type: 'User' | 'Organization';
  repos: number | null;
}

export async function GET(req: NextRequest) {
  if (!isLocal(req)) {
    return NextResponse.json({ error: 'Local requests only.' }, { status: 403 });
  }

  const owners = new Map<string, OwnerEntry>();
  let viewer: string | null = null;
  let error: string | null = null;

  const latest = readSnapshot();
  if (latest) {
    viewer = latest.meta.viewer;
    for (const r of latest.repos) {
      const key = r.owner.toLowerCase();
      const entry = owners.get(key) ?? {
        login: r.owner,
        type: r.ownerType ?? (key === viewer.toLowerCase() ? 'User' : 'Organization'),
        repos: 0,
      };
      entry.repos = (entry.repos ?? 0) + 1;
      owners.set(key, entry);
    }
  }

  try {
    const client = new GitHubClient({ token: resolveToken() });
    viewer = await client.viewer();
    for (const login of await client.listOrgs()) {
      const key = login.toLowerCase();
      if (!owners.has(key)) owners.set(key, { login, type: 'Organization', repos: null });
    }
  } catch (err) {
    error = (err as Error).message;
  }

  // The viewer's own account first, then orgs, then other users.
  const rank = (o: OwnerEntry) =>
    viewer && o.login.toLowerCase() === viewer.toLowerCase() ? 0 : o.type === 'Organization' ? 1 : 2;
  const list = [...owners.values()].sort(
    (a, b) => rank(a) - rank(b) || a.login.localeCompare(b.login),
  );

  return NextResponse.json({ viewer, owners: list, error });
}
