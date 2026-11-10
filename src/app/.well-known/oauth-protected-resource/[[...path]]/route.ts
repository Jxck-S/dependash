/** RFC 9728 protected-resource metadata for /api/mcp (hosted mode). */

import { NextRequest, NextResponse } from 'next/server';
import { cors, hostedOnly, protectedResourceMetadata } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return hostedOnly() ?? cors(NextResponse.json(protectedResourceMetadata(req)));
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}
