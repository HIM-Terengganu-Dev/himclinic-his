import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import {
  getStockTakeById,
  getStockTakeItems,
  updateStockTakeItems,
  completeStockTake,
  markStockTakeItemAdjusted,
  getSingleSkuByCode,
  createProcurementUpdate,
  logActivity,
} from '@/lib/db/queries';
import { updateProductStock, getProduct } from '@/lib/services/woocommerce';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await requireAuth();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    // Handle both Promise and direct params for Next.js version compatibility
    const resolvedParams = params instanceof Promise ? await params : params;
    const stockTakeId = parseInt(resolvedParams.id);

    if (isNaN(stockTakeId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid stock take ID' },
        { status: 400 }
      );
    }

    // Get stock take
    const stockTake = await getStockTakeById(stockTakeId);
    if (!stockTake) {
      return NextResponse.json(
        { success: false, error: 'Stock take not found' },
        { status: 404 }
      );
    }

    if (stockTake.status === 'completed') {
      return NextResponse.json(
        { success: false, error: 'Stock take already completed' },
        { status: 400 }
      );
    }

    // Get request body
    const body = await request.json();
    const { physicalCounts } = body;

    if (!Array.isArray(physicalCounts)) {
      return NextResponse.json(
        { success: false, error: 'physicalCounts must be an array' },
        { status: 400 }
      );
    }

    // Update stock take items with physical counts
    await updateStockTakeItems(stockTakeId, physicalCounts);

    // Update remarks for items
    const { pool } = await import('@/lib/db/connection');
    if (pool) {
      const client = await pool.connect();
      try {
        for (const count of physicalCounts) {
          if (count.remarks) {
            const skuResult = await client.query(
              'SELECT id FROM inventory_management.single_skus WHERE sku = $1',
              [count.sku]
            );
            if (skuResult.rows.length > 0) {
              const skuId = skuResult.rows[0].id;
              await client.query(
                `UPDATE inventory_management.stock_take_items
                 SET adjustment_notes = $1
                 WHERE stock_take_id = $2 AND single_sku_id = $3`,
                [count.remarks, stockTakeId, skuId]
              );
            }
          }
        }
      } finally {
        client.release();
      }
    }

    // Re-fetch items to get updated remarks
    const updatedItems = await getStockTakeItems(stockTakeId);

    // Apply adjustments for items with variances
    const adjustments: Array<{
      sku: string;
      systemQuantity: number;
      physicalQuantity: number;
      variance: number;
      success: boolean;
      error?: string;
    }> = [];

    for (const item of updatedItems) {
      const variance = item.variance || 0;
      
      // Only apply adjustment if there's a variance
      if (variance !== 0 && item.physical_quantity !== null) {
        try {
          // Get current stock from WooCommerce
          const singleSku = await getSingleSkuByCode(item.sku);
          if (!singleSku) {
            adjustments.push({
              sku: item.sku,
              systemQuantity: item.system_quantity,
              physicalQuantity: item.physical_quantity,
              variance,
              success: false,
              error: 'SKU not found',
            });
            continue;
          }

          // Get remarks for this item
          const itemRemark = physicalCounts.find((c: any) => c.sku === item.sku)?.remarks;
          const procurementNotes = itemRemark 
            ? `Stock Take Adjustment - ${stockTake.month}/${stockTake.year}: ${itemRemark}`
            : `Stock Take Adjustment - ${stockTake.month}/${stockTake.year}`;

          // Update WooCommerce stock to physical quantity (Reconciliation)
          await updateProductStock(
            singleSku.woocommerce_product_id,
            item.physical_quantity
          );

          // Create procurement update record
          await createProcurementUpdate({
            singleSkuId: singleSku.id,
            operation: 'set',
            quantity: item.physical_quantity,
            previousQuantity: item.system_quantity,
            newQuantity: item.physical_quantity,
            notes: procurementNotes,
            createdBy: userId,
          });

          // Mark item as adjusted (remarks already saved above)
          await markStockTakeItemAdjusted(
            stockTakeId,
            singleSku.id,
            item.adjustment_notes || `Stock Take Adjustment - Variance: ${variance > 0 ? '+' : ''}${variance}`
          );

          // Log activity
          await logActivity({
            userId,
            action: 'stock_take_adjustment',
            entityType: 'stock_take_item',
            entityId: item.id,
            details: {
              stockTakeId,
              sku: item.sku,
              systemQuantity: item.system_quantity,
              physicalQuantity: item.physical_quantity,
              variance,
            },
            success: true,
          });

          adjustments.push({
            sku: item.sku,
            systemQuantity: item.system_quantity,
            physicalQuantity: item.physical_quantity,
            variance,
            success: true,
          });
        } catch (error) {
          console.error(`Failed to apply adjustment for ${item.sku}:`, error);
          adjustments.push({
            sku: item.sku,
            systemQuantity: item.system_quantity,
            physicalQuantity: item.physical_quantity,
            variance,
            success: false,
            error: String(error),
          });
        }
      }
    }

    // Complete the stock take
    await completeStockTake(stockTakeId, userId);

    // Log stock take completion
    await logActivity({
      userId,
      action: 'stock_take_completed',
      entityType: 'stock_take',
      entityId: stockTakeId,
      details: {
        month: stockTake.month,
        year: stockTake.year,
        totalItems: updatedItems.length,
        adjustmentsApplied: adjustments.filter(a => a.success).length,
        adjustmentsFailed: adjustments.filter(a => !a.success).length,
      },
      success: true,
    });

    return NextResponse.json({
      success: true,
      message: 'Stock take completed successfully',
      adjustments,
      summary: {
        totalItems: updatedItems.length,
        itemsWithVariance: updatedItems.filter(i => i.variance !== 0 && i.variance !== null).length,
        adjustmentsApplied: adjustments.filter(a => a.success).length,
        adjustmentsFailed: adjustments.filter(a => !a.success).length,
      },
    });
  } catch (error) {
    console.error('Error completing stock take:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to complete stock take' },
      { status: 500 }
    );
  }
}

