import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'This endpoint is disabled. We no longer read from WooCommerce API. Use database queries instead.' },
    { status: 410 } // 410 Gone - endpoint no longer available
  );
}










