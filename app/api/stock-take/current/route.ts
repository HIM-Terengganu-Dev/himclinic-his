import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getCurrentStockTake, getStockTakeItems } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const stockTake = await getCurrentStockTake();
    
    if (!stockTake) {
      return NextResponse.json({
        success: true,
        stockTake: null,
        items: [],
      });
    }

    const items = await getStockTakeItems(stockTake.id);

    return NextResponse.json({
      success: true,
      stockTake,
      items,
    });
  } catch (error) {
    console.error('Error fetching current stock take:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stock take' },
      { status: 500 }
    );
  }
}

