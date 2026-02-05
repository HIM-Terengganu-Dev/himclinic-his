import { NextResponse } from 'next/server';
import {
  createProcurementUpdate,
  getSingleSkuByCode,
  getCurrentStockState,
  createStockTransaction
} from '@/lib/db/queries';
import { requireAuth, forbiddenResponse } from '@/lib/auth/middleware';
import { checkAndSendLowStockAlerts } from '@/lib/utils/lowStockAlerts';
import { syncStockToWooCommerce } from '@/lib/services/woocommerce';

export async function POST(request: Request) {
  try {
    // 1. Authentication Check - All authenticated users can update stock
    const session = await requireAuth();
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
      // 3. Get current stock state from transactions (source of truth)
      let currentState;
      try {
        currentState = await getCurrentStockState(sku);
      } catch (error: any) {
        // If no transactions exist, initialize with 0
        if (error.message?.includes('No stock transactions')) {
          currentState = { 
            inWarehouse: 0, 
            availableForPurchase: 0,
            processing: 0,
            pendingConsult: 0,
            pendingReview: 0,
            backorder: 0,
            stock: 0, 
            pending: 0, 
            display: 0 
          };
        } else {
          console.error(`Failed to fetch current stock for ${sku} from transactions`, error);
          return NextResponse.json(
            { success: false, error: 'Failed to fetch current stock from database' },
            { status: 502 }
          );
        }
      }

      // 4. Calculate New Quantity for in_warehouse
      let newInWarehouse: number;
      let quantityChange: number;
      let reconciliationDetails: { physicalCount: number; pendingStock: number; stock: number } | undefined;
      
      if (operation === 'add') {
        quantityChange = quantity;
        newInWarehouse = currentState.inWarehouse + quantity;
      } else if (operation === 'subtract') {
        quantityChange = -quantity;
        newInWarehouse = Math.max(0, currentState.inWarehouse - quantity);
      } else { // set (reconciliation)
        // For reconciliation: user enters physical count
        // in_warehouse should be set to physical count
        newInWarehouse = Math.max(0, quantity);
        quantityChange = newInWarehouse - currentState.inWarehouse;
        
        reconciliationDetails = {
          physicalCount: quantity,
          pendingStock: currentState.pendingConsult + currentState.pendingReview,
          stock: newInWarehouse
        };
        console.log(`📊 Reconciliation for ${sku}: Physical=${quantity}, in_warehouse=${newInWarehouse}`);
      }

      // Ensure no negative in_warehouse
      if (newInWarehouse < 0) newInWarehouse = 0;
      
      // 5. Handle backorder deduction when stock is added
      const backorderBefore = currentState.backorder;
      let backorderAfter = backorderBefore;
      if (quantityChange > 0 && backorderBefore > 0) {
        // Stock was added, deduct from backorder (up to the amount added)
        backorderAfter = Math.max(0, backorderBefore - quantityChange);
      }
      
      // Calculate available_for_purchase
      const availableAfter = Math.max(0, newInWarehouse - currentState.pendingConsult - currentState.pendingReview - currentState.processing);

      // 5. Log to Database (Procurement History & Activity Log) - Create this first so we can reference it in transaction
      let procurementRecord;
      try {
        console.log(`📝 Logging procurement update to DB: SKU=${sku}, Operation=${operation}, Quantity=${quantity}, UserId=${userId}`);
        procurementRecord = await createProcurementUpdate({
          singleSkuId: singleSku.id,
          operation,
          quantity,
          previousQuantity: currentState.inWarehouse, // Use in_warehouse
          newQuantity: newInWarehouse, // Use in_warehouse
          notes,
          createdBy: userId
        });
        console.log(`✅ Successfully logged procurement update: ID=${procurementRecord.id}, Operation=${procurementRecord.operation}`);
      } catch (dbError: any) {
        console.error('❌ Failed to log procurement update to DB:', dbError);
        return NextResponse.json(
          { success: false, error: 'Failed to log procurement update' },
          { status: 502 }
        );
      }

      // 6. Create stock transaction (source of truth)
      try {
        const transactionType = operation === 'add' ? 'manual_add' : operation === 'subtract' ? 'manual_subtract' : 'manual_set';
        
        await createStockTransaction({
          sku,
          singleSkuId: singleSku.id,
          transactionType,
          quantityChange,
          // Legacy fields
          stockBefore: currentState.inWarehouse,
          stockAfter: newInWarehouse,
          pendingBefore: currentState.pendingConsult + currentState.pendingReview,
          pendingAfter: currentState.pendingConsult + currentState.pendingReview, // Pending unchanged for manual updates
          // New fields
          inWarehouseBefore: currentState.inWarehouse,
          inWarehouseAfter: newInWarehouse,
          processingBefore: currentState.processing,
          processingAfter: currentState.processing, // Processing unchanged
          pendingConsultBefore: currentState.pendingConsult,
          pendingConsultAfter: currentState.pendingConsult, // Pending unchanged
          pendingReviewBefore: currentState.pendingReview,
          pendingReviewAfter: currentState.pendingReview, // Pending unchanged
          backorderBefore,
          backorderAfter,
          sourceType: 'manual',
          sourceId: procurementRecord.id,
          createdBy: userId,
          details: {
            operation,
            quantity,
            notes,
            procurementUpdateId: procurementRecord.id,
            availableForPurchase: availableAfter,
            backorderDeducted: backorderBefore - backorderAfter
          }
        });
        
        console.log(`✅ Created transaction for ${sku}: in_warehouse ${currentState.inWarehouse}→${newInWarehouse}, backorder ${backorderBefore}→${backorderAfter}, available=${availableAfter}`);
      } catch (error) {
        console.error(`❌ Failed to create transaction for ${sku}:`, error);
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
          { success: false, error: 'Failed to create stock transaction' },
          { status: 502 }
        );
      }

      // Sync stock to WooCommerce (async, don't block response)
      syncStockToWooCommerce(sku).catch(err => {
          console.error('Error syncing stock to WooCommerce:', err);
      });

      // Check for low stock alerts (async, don't block response)
      checkAndSendLowStockAlerts([sku]).catch(err => {
          console.error('Error checking low stock alerts:', err);
      });

      return NextResponse.json({
        success: true,
        sku,
        newLocalQuantity: newInWarehouse,
        inventory: { [sku]: newInWarehouse }, // Partial update response
        reconciliationDetails, // Only present for reconciliation (set operation)
        availableForPurchase: availableAfter,
        backorder: backorderAfter
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

