/**
 * Local mode only: read and replace the last-fetch file, so the dashboard
 * and `npm run snapshot` / `npm run demo` share one store.
 *
 * Hosted mode keeps each user's fetch in their own browser (IndexedDB) and
 * never stores alert data on the server, so this route answers 404 there.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appMode, isLocalRequest } from '@/lib/mode';
import { readSnapshot, writeSnapshot } from '@/lib/store';
import { Snapshot } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function refuse(req: NextRequest): NextResponse | null {
  if (appMode() !== 'local') {
    return NextResponse.json({ error: 'Not available in hosted mode.' }, { status: 404 });
  }
  if (!isLocalRequest(req)) {
    return NextResponse.json({ error: 'Local requests only.' }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const refused = refuse(req);
  if (refused) return refused;
  return NextResponse.json({ snapshot: readSnapshot() });
}

export async function PUT(req: NextRequest) {
  const refused = refuse(req);
  if (refused) return refused;

  const snapshot = (await req.json().catch(() => null)) as Snapshot | null;
  if (
    !snapshot ||
    snapshot.schemaVersion !== 1 ||
    !snapshot.meta ||
    !Array.isArray(snapshot.repos) ||
    !Array.isArray(snapshot.alerts)
  ) {
    return NextResponse.json({ error: 'Not a dependash snapshot.' }, { status: 400 });
  }
  return NextResponse.json({ file: writeSnapshot(snapshot) });
}
