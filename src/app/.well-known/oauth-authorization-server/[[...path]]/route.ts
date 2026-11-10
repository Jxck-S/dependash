/** RFC 8414 authorization-server metadata (hosted mode). */

import { NextRequest, NextResponse } from 'next/server';
import { authorizationServerMetadata, cors, hostedOnly } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return hostedOnly() ?? cors(NextResponse.json(authorizationServerMetadata(req)));
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}
