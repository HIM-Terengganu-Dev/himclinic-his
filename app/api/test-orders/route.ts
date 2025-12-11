import { NextResponse } from 'next/server';
import { getOrder } from '@/lib/services/woocommerce';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderIds = searchParams.get('ids')?.split(',') || ['10328', '10341'];
    
    const results = await Promise.all(
      orderIds.map(async (id) => {
        try {
          const order = await getOrder(parseInt(id));
          return {
            orderId: order.id,
            date_created: order.date_created,
            date_created_gmt: order.date_created_gmt || 'N/A',
            status: order.status,
            // Parse and show in different formats
            parsed: {
              asUTC: new Date(order.date_created).toISOString(),
              asLocal: new Date(order.date_created).toString(),
              asGMT8: new Date(new Date(order.date_created).getTime() + (8 * 60 * 60 * 1000)).toISOString(),
            },
            // Current time for comparison
            now: {
              utc: new Date().toISOString(),
              local: new Date().toString(),
              gmt8: new Date(new Date().getTime() + (8 * 60 * 60 * 1000)).toISOString(),
            },
            // Time difference
            timeDiff: {
              ms: Date.now() - new Date(order.date_created).getTime(),
              hours: (Date.now() - new Date(order.date_created).getTime()) / (1000 * 60 * 60),
              days: (Date.now() - new Date(order.date_created).getTime()) / (1000 * 60 * 60 * 24),
            }
          };
        } catch (error: any) {
          return {
            orderId: id,
            error: error.message || 'Failed to fetch order'
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      orders: results,
      note: 'All timestamps are shown for debugging timezone issues'
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

