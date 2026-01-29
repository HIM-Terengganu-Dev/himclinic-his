import { NextResponse } from 'next/server';
import {
  createProcurementUpdate,
  getSingleSkuByCode,
  getCurrentStockState,
  createStockTransaction
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
      // 3. Get current stock state from transactions (source of truth)
      let currentState;
      try {
        currentState = await getCurrentStockState(sku);
      } catch (error: any) {
        // If no transactions exist, initialize with 0
        if (error.message?.includes('No stock transactions')) {
          currentState = { stock: 0, pending: 0, display: 0 };
        } else {
          console.error(`Failed to fetch current stock for ${sku} from transactions`, error);
          return NextResponse.json(
            { success: false, error: 'Failed to fetch current stock from database' },
            { status: 502 }
          );
        }
      }

      // 4. Calculate New Quantity
      let newQuantity: number;
      let quantityChange: number;
      let reconciliationDetails: { physicalCount: number; pendingStock: number; stock: number } | undefined;
      
      if (operation === 'add') {
        quantityChange = quantity;
        newQuantity = currentState.stock + quantity;
      } else if (operation === 'subtract') {
        quantityChange = -quantity;
        newQuantity = Math.max(0, currentState.stock - quantity);
      } else { // set (reconciliation)
        // For reconciliation: user enters physical count
        // Stock should be physical - pending, so dashboard shows: (physical - pending) + pending = physical
        const pendingStock = currentState.pending;
        newQuantity = Math.max(0, quantity - pendingStock); // Physical count minus pending stock
        quantityChange = newQuantity - currentState.stock;
        
        // Warn if pending stock exceeds physical count (data integrity issue)
        if (pendingStock > quantity) {
          console.warn(`⚠️ WARNING: Reconciliation for ${sku} - Pending stock (${pendingStock}) exceeds physical count (${quantity}). This may indicate a data integrity issue.`);
        }
        
        reconciliationDetails = {
          physicalCount: quantity,
          pendingStock: pendingStock,
          stock: newQuantity
        };
        console.log(`📊 Reconciliation for ${sku}: Physical=${quantity}, Pending=${pendingStock}, Stock=${newQuantity} (dashboard will show ${newQuantity}+${pendingStock}=${quantity})`);
      }

      // Ensure no negative stock
      if (newQuantity < 0) newQuantity = 0;

      // 5. Log to Database (Procurement History & Activity Log) - Create this first so we can reference it in transaction
      let procurementRecord;
      try {
        console.log(`📝 Logging procurement update to DB: SKU=${sku}, Operation=${operation}, Quantity=${quantity}, UserId=${userId}`);
        procurementRecord = await createProcurementUpdate({
          singleSkuId: singleSku.id,
          operation,
          quantity,
          previousQuantity: currentState.stock,
          newQuantity,
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
          stockBefore: currentState.stock,
          stockAfter: newQuantity,
          pendingBefore: currentState.pending,
          pendingAfter: currentState.pending, // Pending stock unchanged for manual updates
          sourceType: 'manual',
          sourceId: procurementRecord.id,
          createdBy: userId,
          details: {
            operation,
            quantity,
            notes,
            procurementUpdateId: procurementRecord.id
          }
        });
        
        console.log(`✅ Created transaction for ${sku}: ${currentState.stock}→${newQuantity}`);
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

      // Note: Combo availability is calculated from transactions, no need to update WooCommerce

      return NextResponse.json({
        success: true,
        sku,
        newLocalQuantity: newQuantity,
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

