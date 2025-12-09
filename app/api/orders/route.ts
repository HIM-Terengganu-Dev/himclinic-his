import { NextResponse } from 'next/server';
import { getOrders, getRecentOrders } from '@/lib/services/woocommerce';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status') || undefined;

    let orders;
    if (status) {
      orders = await getOrders({ per_page: limit, status });
    } else {
      orders = await getRecentOrders(limit);
    }

    return NextResponse.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error('Error in orders API:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}




