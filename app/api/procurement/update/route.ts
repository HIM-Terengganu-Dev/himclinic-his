import { NextResponse } from 'next/server';
import { updateProductStock, getProduct } from '@/lib/services/woocommerce';
import { calculateComboAvailability } from '@/lib/utils/inventory';
import {
  createProcurementUpdate,
  getSingleSkuByCode,
  getAllComboSkus,
  getAllSingleSkus,
  getPendingConsultationStockBySku,
  logStockMovement
} from '@/lib/db/queries';
import { requireAdmin, forbiddenResponse } from '@/lib/auth/middleware';

export async function POST(request: Request) {
  try {
    // 1. Admin Role Check - Only admins can update stock
    const session = await requireAdmin();
    if (!session) {
      return forbiddenResponse();
    }
    const userId = session.user.id;

    const body = await request.json();
    const { sku, quantity, operation, notes } = body;

    if (!sku || quantity === undefined || !operation) {
      return NextResponse.json(
        { success: false, error: 'sku, quantity, and operation are required' },
        { status: 400 }
      );
    }

    // Notes are required for Reconciliation (set operation)
    if (operation === 'set' && !notes?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Notes are required for Reconciliation' },
        { status: 400 }
      );
    }

    // 2. Validate SKU exists in System DB
    const singleSku = await getSingleSkuByCode(sku);
    if (!singleSku) {
      return NextResponse.json(
        { success: false, error: 'Invalid single SKU' },
        { status: 400 }
      );
    }

    if (operation === 'add' || operation === 'subtract' || operation === 'set') {
      // 3. Fetch CURRENT stock from WooCommerce to ensure accuracy
      // This is the "Source of Truth" check
      // IMPORTANT: This is the actual WC stock (without pending-consult additions)
      // Pending stock is only for dashboard display, never used in calculations or writes
      let currentWooStock = 0;
      try {
        const wooProduct = await getProduct(singleSku.woocommerce_product_id);
        currentWooStock = wooProduct.stock_quantity || 0; // Actual WC stock, not including pending-consult
      } catch (error) {
        console.error(`Failed to fetch current stock for ${sku} from WooCommerce`, error);
        // Fallback? Or fail? Fail is safer for data integrity.
        return NextResponse.json(
          { success: false, error: 'Failed to fetch current stock from WooCommerce' },
          { status: 502 }
        );
      }

      // 4. Calculate New Quantity
      let newQuantity: number;
      let reconciliationDetails: { physicalCount: number; pendingStock: number; wcStock: number } | undefined;
      if (operation === 'add') {
        newQuantity = currentWooStock + quantity;
      } else if (operation === 'subtract') {
        newQuantity = currentWooStock - quantity;
      } else { // set (reconciliation)
        // For reconciliation: user enters physical count
        // WC stock should be physical - pending, so dashboard shows: (physical - pending) + pending = physical
        const pendingStock = await getPendingConsultationStockBySku(sku);
        newQuantity = quantity - pendingStock; // Physical count minus pending stock
        
        // Warn if pending stock exceeds physical count (data integrity issue)
        if (pendingStock > quantity) {
          console.warn(`⚠️ WARNING: Reconciliation for ${sku} - Pending stock (${pendingStock}) exceeds physical count (${quantity}). This may indicate a data integrity issue.`);
        }
        
        reconciliationDetails = {
          physicalCount: quantity,
          pendingStock: pendingStock,
          wcStock: newQuantity
        };
        console.log(`📊 Reconciliation for ${sku}: Physical=${quantity}, Pending=${pendingStock}, WC Stock=${newQuantity} (dashboard will show ${newQuantity}+${pendingStock}=${quantity})`);
      }

      // Ensure no negative stock
      if (newQuantity < 0) newQuantity = 0;

      // 5. Update WooCommerce Stock (Writing to Source of Truth)
      // IMPORTANT: Write actual stock quantity (without pending-consult) to WC
      // WC is not aware of pending-consult, so we write the actual quantity
      let singleSkuUpdated = false;
      try {
        await updateProductStock(singleSku.woocommerce_product_id, newQuantity); // Actual stock, not including pending-consult
        singleSkuUpdated = true;
        console.log(`✅ Updated single SKU ${sku} in WooCommerce: ${newQuantity} units`);
      } catch (error) {
        console.error(`❌ Failed to update single SKU ${sku} in WooCommerce:`, error);
        // If update fails, we should NOT log the procurement update in DB?
        // Or log it as failed?
        await import('@/lib/db/queries').then(m => m.logActivity({
          userId,
          action: 'procurement_update_error',
          entityType: 'single_sku',
          entityId: singleSku.id,
          details: { sku, quantity, operation, error: String(error) },
          success: false,
          errorMessage: String(error)
        }));

        return NextResponse.json(
          { success: false, error: 'Failed to update WooCommerce' },
          { status: 502 }
        );
      }

      // 6. Log to Database (Procurement History & Activity Log)
      try {
        console.log(`📝 Logging procurement update to DB: SKU=${sku}, Operation=${operation}, Quantity=${quantity}, UserId=${userId}`);
        const procurementRecord = await createProcurementUpdate({
          singleSkuId: singleSku.id,
          operation,
          quantity,
          previousQuantity: currentWooStock,
          newQuantity,
          notes,
          createdBy: userId
        });
        console.log(`✅ Successfully logged procurement update: ID=${procurementRecord.id}, Operation=${procurementRecord.operation}`);
        
        // Get current pending stock for this SKU
        const currentPendingStock = await getPendingConsultationStockBySku(sku);
        
        // Log stock movement
        await logStockMovement({
          sku,
          singleSkuId: singleSku.id,
          previousStock: currentWooStock,
          newStock: newQuantity,
          pendingStock: currentPendingStock,
          sourceType: 'manual',
          sourceId: procurementRecord.id,
          createdBy: userId,
          details: {
            operation,
            quantity,
            notes
          }
        });
      } catch (dbError: any) {
        console.error('❌ Failed to log procurement update to DB:', dbError);
        console.error('Error details:', {
          message: dbError?.message,
          code: dbError?.code,
          detail: dbError?.detail,
          constraint: dbError?.constraint,
          stack: dbError?.stack
        });
        // We don't fail the request if DB log fails, but we should alert?
        // Since WC is updated, the business operation succeeded.
        // However, we should still log this as an error activity
        try {
          await import('@/lib/db/queries').then(m => m.logActivity({
            userId,
            action: 'procurement_update_db_log_failed',
            entityType: 'single_sku',
            entityId: singleSku.id,
            details: { sku, quantity, operation, error: String(dbError), errorDetails: dbError },
            success: false,
            errorMessage: dbError?.message || String(dbError)
          }));
        } catch (logError) {
          console.error('Failed to log the DB log failure:', logError);
        }
      }

      // 7. Calculate and Update Combo SKUs
      // We need ALL single SKU stocks to recalculate combos accurately.
      // Optimally, we fetched them all, but that's heavy.
      // We can fetch just the ones needed for combos?
      // For now, let's fetch ALL products from WC to be safe and consistent with previous logic,
      // OR just rely on the fact that we changed ONE, and assume others are stable?
      // Better: Fetch all single SKUs from DB, then get their stocks from WC?
      // For performance, maybe we assume other stocks haven't changed in the last 100ms?
      // But we don't have them in memory in variables here (serverless function).

      // Let's use `updateProductStock` for combos.
      // We need to know the stock of OTHER components.
      // This is tricky without a full inventory state.

      // REVISIT: The existing `POST /api/inventory` maintained a state.
      // If we move to stateless, we must fetch state.
      // Let's call the `GET /api/inventory` logic? No, that's internal.

      // Strategy:
      // 1. Get all Combo SKUs from DB
      // 2. Identify which combos contain THIS sku.
      // 3. For those combos, identify ALL their components.
      // 4. Fetch stock for ALL those components from WC.
      // 5. Calculate availability.
      // 6. Update WC.

      const allCombos = await getAllComboSkus();
      const affectedCombos = allCombos.filter((c: any) =>
        c.components.some((comp: any) => comp.sku === sku)
      );

      const wooCommerceUpdates = [];

      if (affectedCombos.length > 0) {
        // Collect all unique component SKUs needed
        const neededSkus = new Set<string>();
        affectedCombos.forEach((c: any) => {
          c.components.forEach((comp: any) => neededSkus.add(comp.sku));
        });

        // We know the stock of the CURRENT sku is `newQuantity`.
        // We need stocks of others.
        // Fetch from DB to get WC IDs
        // Then fetch from WC.

        // Optimization: Fetch all single SKUs from DB to map SKU -> WC_ID
        const allSingleSkus = await getAllSingleSkus();
        const skuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));

        // Prepare a map of current stocks
        const stockMap: Record<string, number> = {};
        stockMap[sku] = newQuantity;

        // Fetch missing stocks
        // This could be N requests. Parallelize.
        const missingSkus = Array.from(neededSkus).filter(s => s !== sku);

        await Promise.all(missingSkus.map(async (s) => {
          const sData = skuMap.get(s);
          if (sData) {
            try {
              const p = await getProduct(sData.woocommerce_product_id);
              stockMap[s] = p.stock_quantity || 0;
            } catch (e) {
              console.warn(`Failed to fetch stock for component ${s}`, e);
              stockMap[s] = 0; // Safe fallback
            }
          }
        }));

        // Calculate and Update combo stock in WooCommerce
        for (const combo of affectedCombos) {
          // Calculate max available based on component stock
          let comboLimit = Infinity;
          for (const comp of combo.components) {
            const compStock = stockMap[comp.sku] || 0;
            const canMake = Math.floor(compStock / comp.quantity);
            if (canMake < comboLimit) comboLimit = canMake;
          }
          if (comboLimit === Infinity) comboLimit = 0;

            try {
              // IMPORTANT: Write actual calculated combo availability (without pending-consult) to WC
              // WC is not aware of pending-consult, so we write the actual calculated quantity
              await updateProductStock(combo.woocommerce_product_id, comboLimit); // Actual stock, not including pending-consult
            wooCommerceUpdates.push({
              sku: combo.sku,
              name: combo.name,
              newStock: comboLimit
            });
          } catch (e) {
            console.warn(`Failed to update combo ${combo.sku}`, e);
          }
        }
      }

      return NextResponse.json({
        success: true,
        sku,
        newLocalQuantity: newQuantity,
        singleSkuUpdatedInWooCommerce: singleSkuUpdated,
        affectedComboSKUs: wooCommerceUpdates,
        inventory: { [sku]: newQuantity }, // Partial update response
        reconciliationDetails, // Only present for reconciliation (set operation)
      });

    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid operation. Use add, subtract, or set' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error in procurement update:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update procurement stock' },
      { status: 500 }
    );
  }
}

