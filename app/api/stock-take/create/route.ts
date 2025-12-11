import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getProducts } from '@/lib/services/woocommerce';
import {
  createStockTake,
  getStockTakeByMonth,
  createStockTakeItems,
  getAllSingleSkus,
} from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await requireAuth();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const now = new Date();
    const month = now.getMonth() + 1; // JavaScript months are 0-indexed
    const year = now.getFullYear();

    // Check if stock take already exists for this month
    const existing = await getStockTakeByMonth(month, year);
    if (existing) {
      // Return existing stock take with items
      const { getStockTakeItems } = await import('@/lib/db/queries');
      const items = await getStockTakeItems(existing.id);
      return NextResponse.json({
        success: true,
        stockTake: existing,
        items,
        message: 'Stock take already exists for this month',
      });
    }

    // Fetch current stock from WooCommerce
    const products = await getProducts({ per_page: 100 });
    const singleSkus = await getAllSingleSkus();

    if (!singleSkus || singleSkus.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No single SKUs found in the system. Please configure SKUs first.' },
        { status: 400 }
      );
    }

    // Create snapshot data
    const snapshotData: Record<string, number> = {};
    singleSkus.forEach((sku) => {
      const product = products.find((p) => p.id === sku.woocommerce_product_id);
      snapshotData[sku.sku] = product?.stock_quantity || 0;
    });

    // Create stock take record
    const stockTake = await createStockTake({
      userId,
      month,
      year,
      snapshotData,
    });

    // Create stock take items
    const items = await createStockTakeItems(
      stockTake.id,
      singleSkus.map((sku) => ({
        singleSkuId: sku.id,
        systemQuantity: snapshotData[sku.sku] || 0,
      }))
    );

    if (!items || items.length === 0) {
      console.error('No stock take items were created');
      return NextResponse.json(
        { success: false, error: 'Failed to create stock take items' },
        { status: 500 }
      );
    }

    // Log activity
    const { logActivity } = await import('@/lib/db/queries');
    await logActivity({
      userId,
      action: 'stock_take_created',
      entityType: 'stock_take',
      entityId: stockTake.id,
      details: { month, year, itemCount: items.length },
      success: true,
    });

    return NextResponse.json({
      success: true,
      stockTake,
      items,
    });
  } catch (error) {
    console.error('Error creating stock take:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = error instanceof Error ? error.stack : String(error);
    console.error('Error details:', errorDetails);
    return NextResponse.json(
      { 
        success: false, 
        error: `Failed to create stock take: ${errorMessage}`,
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
      },
      { status: 500 }
    );
  }
}

