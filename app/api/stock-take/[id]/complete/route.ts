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
  getAllComboSkus,
  getAllSingleSkus,
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
          // IMPORTANT: Write actual physical quantity (without pending-consult) to WC
          // WC is not aware of pending-consult, so we write the actual physical count
          await updateProductStock(
            singleSku.woocommerce_product_id,
            item.physical_quantity // Actual physical quantity, not including pending-consult
          );

          // Create procurement update record
          const procurementRecord = await createProcurementUpdate({
            singleSkuId: singleSku.id,
            operation: 'set',
            quantity: item.physical_quantity,
            previousQuantity: item.system_quantity,
            newQuantity: item.physical_quantity,
            notes: procurementNotes,
            createdBy: userId,
          });
          
          // Log stock movement
          const { logStockMovement } = await import('@/lib/db/queries');
          await logStockMovement({
            sku: item.sku,
            singleSkuId: singleSku.id,
            previousStock: item.system_quantity,
            newStock: item.physical_quantity,
            sourceType: 'stock_take',
            sourceId: stockTakeId,
            createdBy: userId,
            details: {
              variance,
              physicalQuantity: item.physical_quantity,
              systemQuantity: item.system_quantity,
              remarks: itemRemark,
              procurementUpdateId: procurementRecord.id
            }
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

    // Recalculate and update combo SKU availability for all affected single SKUs
    const affectedSingleSkus = adjustments
      .filter(a => a.success)
      .map(a => a.sku);

    if (affectedSingleSkus.length > 0) {
      console.log(`Recalculating combo SKUs for ${affectedSingleSkus.length} adjusted single SKUs`);
      
      const allCombos = await getAllComboSkus();
      const allSingleSkus = await getAllSingleSkus();
      const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));

      // Find all combo SKUs that use any of the affected single SKUs
      const affectedCombos = allCombos.filter((c: any) => {
        const components = Array.isArray(c.components) 
          ? c.components 
          : JSON.parse(c.components || '[]');
        return components.some((comp: any) => affectedSingleSkus.includes(comp.sku));
      });

      if (affectedCombos.length > 0) {
        console.log(`Found ${affectedCombos.length} combo SKUs to recalculate`);

        // Build stock map: use updated stock for adjusted SKUs, fetch others from WooCommerce
        const stockMap: Record<string, number> = {};

        // Get updated stock for adjusted SKUs (from adjustments)
        for (const adj of adjustments.filter(a => a.success)) {
          const singleSku = singleSkuMap.get(adj.sku);
          if (singleSku && singleSku.woocommerce_product_id) {
            stockMap[adj.sku] = adj.physicalQuantity; // Use the physical quantity we just set
          }
        }

        // Collect all unique component SKUs needed for affected combos
        const neededSkus = new Set<string>();
        affectedCombos.forEach((c: any) => {
          const components = Array.isArray(c.components) 
            ? c.components 
            : JSON.parse(c.components || '[]');
          components.forEach((comp: any) => neededSkus.add(comp.sku));
        });

        // Fetch stock for other components needed for combo calculations
        const missingSkus = Array.from(neededSkus).filter(s => !stockMap.hasOwnProperty(s));
        await Promise.all(missingSkus.map(async (s) => {
          const sData = singleSkuMap.get(s);
          if (sData && sData.woocommerce_product_id) {
            try {
              const p = await getProduct(sData.woocommerce_product_id);
              stockMap[s] = p.stock_quantity || 0;
            } catch (e) {
              console.warn(`Failed to fetch stock for component ${s}`, e);
              stockMap[s] = 0;
            }
          }
        }));

        // Calculate and update combo stock in WooCommerce
        const comboUpdates: Array<{ sku: string; newStock: number }> = [];

        for (const combo of affectedCombos) {
          if (!combo.woocommerce_product_id) {
            console.warn(`⚠️ Combo ${combo.sku} missing WooCommerce product ID`);
            continue;
          }

          const components = Array.isArray(combo.components) 
            ? combo.components 
            : JSON.parse(combo.components || '[]');
          let comboLimit = Infinity;

          for (const comp of components) {
            const stock = stockMap[comp.sku] || 0;
            const canMake = Math.floor(stock / comp.quantity);
            if (canMake < comboLimit) comboLimit = canMake;
          }

          if (comboLimit === Infinity) comboLimit = 0;

          try {
            // IMPORTANT: Write actual calculated combo availability (without pending-consult) to WC
            // WC is not aware of pending-consult, so we write the actual calculated quantity
            await updateProductStock(combo.woocommerce_product_id, comboLimit); // Actual stock, not including pending-consult
            comboUpdates.push({ sku: combo.sku, newStock: comboLimit });
            console.log(`✅ Updated combo ${combo.sku} in WooCommerce: ${comboLimit} units`);
          } catch (e: any) {
            console.error(`❌ Failed to update combo ${combo.sku} in WooCommerce:`, e.message);
          }
        }

        if (comboUpdates.length > 0) {
          console.log(`Successfully updated ${comboUpdates.length} combo SKUs after stock take completion`);
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

