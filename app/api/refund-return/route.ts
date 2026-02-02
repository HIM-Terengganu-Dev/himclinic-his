import { NextResponse } from 'next/server';
import {
  createProcurementUpdate,
  getSingleSkuByCode,
  getAllComboSkus,
  getAllSingleSkus,
  getCurrentStockState,
  createStockTransaction
} from '@/lib/db/queries';
import { requireAdmin, forbiddenResponse } from '@/lib/auth/middleware';

export async function POST(request: Request) {
  try {
    // 1. Admin Role Check - Only admins can process refunds/returns
    const session = await requireAdmin(request);
    if (!session) {
      return forbiddenResponse();
    }
    const userId = session.user.id;

    const body = await request.json();
    const { sku, quantity, condition, notes, orderId } = body;

    // 2. Validation
    if (!sku || quantity === undefined || !condition) {
      return NextResponse.json(
        { success: false, error: 'sku, quantity, and condition are required' },
        { status: 400 }
      );
    }

    // Validate condition
    if (!['good', 'damaged', 'lost'].includes(condition)) {
      return NextResponse.json(
        { success: false, error: 'condition must be one of: good, damaged, lost' },
        { status: 400 }
      );
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) {
      return NextResponse.json(
        { success: false, error: 'quantity must be a positive number' },
        { status: 400 }
      );
    }

    // 3. Validate SKU exists in System DB
    const singleSku = await getSingleSkuByCode(sku);
    if (!singleSku) {
      return NextResponse.json(
        { success: false, error: 'Invalid single SKU' },
        { status: 400 }
      );
    }

    // 4. Get CURRENT stock from database (source of truth)
    let currentState;
    try {
      currentState = await getCurrentStockState(sku);
    } catch (error) {
      console.error(`Failed to fetch current stock for ${sku} from database`, error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch current stock from database' },
        { status: 502 }
      );
    }

    const currentStock = currentState.stock;

    // 5. Only restore stock if condition is 'good'
    // For 'lost' and 'damaged', do not restore stock - only log the return
    const shouldRestoreStock = condition === 'good';
    let singleSkuUpdated = false;
    let newQuantity = currentStock;

    if (shouldRestoreStock) {
      // Calculate New Quantity (add for good condition returns)
      newQuantity = currentStock + qty;

      // 6. Update stock in database via stock_transactions (only for good condition)
      try {
        await createStockTransaction({
          sku,
          singleSkuId: singleSku.id,
          transactionType: 'refund_return',
          quantityChange: qty,
          stockBefore: currentState.stock,
          stockAfter: newQuantity,
          pendingBefore: currentState.pending,
          pendingAfter: currentState.pending, // No pending change for refund/return
          sourceType: 'manual',
          createdBy: userId,
          details: {
            condition,
            orderId,
            notes
          }
        });
        singleSkuUpdated = true;
        console.log(`✅ Updated single SKU ${sku} in database (refund/return): ${newQuantity} units (condition: ${condition})`);
      } catch (error) {
        console.error(`❌ Failed to update single SKU ${sku} in database:`, error);
        await import('@/lib/db/queries').then(m => m.logActivity({
          userId,
          action: 'refund_return_error',
          entityType: 'single_sku',
          entityId: singleSku.id,
          details: { sku, quantity: qty, condition, error: String(error) },
          success: false,
          errorMessage: String(error)
        }));

        return NextResponse.json(
          { success: false, error: 'Failed to update database' },
          { status: 502 }
        );
      }
    } else {
      console.log(`⏭️ Skipping stock restoration for ${sku}: Condition is '${condition}' (only 'good' condition restores stock)`);
    }

    // 7. Log to Database (Procurement History & Activity Log)
    // Always log refund/return regardless of condition (for tracking purposes)
    try {
      // Parse orderId to integer if provided
      const orderIdInt = orderId ? parseInt(String(orderId)) : undefined;
      
      console.log(`📝 Logging refund/return to DB: SKU=${sku}, Condition=${condition}, Quantity=${qty}, OrderId=${orderIdInt || 'none'}, UserId=${userId}, StockRestored=${shouldRestoreStock}`);
      const procurementRecord = await createProcurementUpdate({
        singleSkuId: singleSku.id,
        operation: shouldRestoreStock ? 'add' : 'set', // 'add' if good condition, 'set' if lost/damaged (no change)
        quantity: qty,
          previousQuantity: currentStock,
          newQuantity: shouldRestoreStock ? newQuantity : currentStock, // Only change if good condition
        notes: notes || undefined,
        returnCondition: condition as 'lost' | 'damaged' | 'good',
        orderId: orderIdInt,
        createdBy: userId
      });
      console.log(`✅ Successfully logged refund/return: ID=${procurementRecord.id}, Condition=${condition}, StockRestored=${shouldRestoreStock}`);
    } catch (dbError: any) {
      console.error('❌ Failed to log refund/return to DB:', dbError);
      // Log error but don't fail the request
      await import('@/lib/db/queries').then(m => m.logActivity({
        userId,
        action: 'refund_return_db_log_failed',
        entityType: 'single_sku',
        entityId: singleSku.id,
        details: { sku, quantity: qty, condition, error: String(dbError) },
        success: false,
        errorMessage: dbError?.message || String(dbError)
      }));
    }

    // 8. Calculate Combo SKU availability (for logging only - we don't update WooCommerce)
    const comboUpdates = [];
    
    if (shouldRestoreStock && singleSkuUpdated) {
      const allCombos = await getAllComboSkus();
      const affectedCombos = allCombos.filter((c: any) =>
        c.components.some((comp: any) => comp.sku === sku)
      );

      if (affectedCombos.length > 0) {
        const neededSkus = new Set<string>();
        affectedCombos.forEach((c: any) => {
          c.components.forEach((comp: any) => neededSkus.add(comp.sku));
        });

        const stockMap: Record<string, number> = {};
        stockMap[sku] = newQuantity;

        const missingSkus = Array.from(neededSkus).filter(s => s !== sku);

        await Promise.all(missingSkus.map(async (s) => {
          try {
            const currentState = await getCurrentStockState(s);
            stockMap[s] = currentState.stock;
          } catch (e) {
            console.warn(`Failed to fetch stock for component ${s} from database`, e);
            stockMap[s] = 0;
          }
        }));

        for (const combo of affectedCombos) {
          const components = Array.isArray(combo.components) ? combo.components : JSON.parse(combo.components || '[]');
          let comboLimit = Infinity;
          for (const comp of components) {
            const compStock = stockMap[comp.sku] || 0;
            const canMake = Math.floor(compStock / comp.quantity);
            if (canMake < comboLimit) comboLimit = canMake;
          }
          if (comboLimit === Infinity) comboLimit = 0;

          comboUpdates.push({
            sku: combo.sku,
            name: combo.name,
            newStock: comboLimit
          });
          console.log(`📊 Calculated combo ${combo.sku} availability: ${comboLimit} units (logged only, not updated in WooCommerce)`);
        }
      }
    } else if (!shouldRestoreStock) {
      console.log(`⏭️ Skipping combo SKU updates: Stock was not restored (condition: ${condition})`);
    }

    const conditionLabel = condition.charAt(0).toUpperCase() + condition.slice(1);
    const stockMessage = shouldRestoreStock 
      ? `Stock restored.` 
      : `Stock not restored (${condition} condition).`;

    return NextResponse.json({
      success: true,
      sku,
      condition,
      stockRestored: shouldRestoreStock,
      newLocalQuantity: newQuantity,
      singleSkuUpdatedInDatabase: singleSkuUpdated,
      affectedComboSKUs: comboUpdates,
      message: `Refund/return processed successfully. Condition: ${conditionLabel}. ${stockMessage}`
    });

  } catch (error) {
    console.error('Error in refund/return:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process refund/return' },
      { status: 500 }
    );
  }
}

