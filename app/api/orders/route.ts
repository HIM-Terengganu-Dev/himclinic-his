import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return NextResponse.json(
    { success: false, error: 'This endpoint is disabled. We no longer read from WooCommerce API. Order data is received via webhooks only.' },
    { status: 410 } // 410 Gone - endpoint no longer available
  );
}




