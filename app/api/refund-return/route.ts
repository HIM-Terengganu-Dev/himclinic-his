import { NextResponse } from 'next/server';
import { updateProductStock, getProduct } from '@/lib/services/woocommerce';
import {
  createProcurementUpdate,
  getSingleSkuByCode,
  getAllComboSkus,
  getAllSingleSkus
} from '@/lib/db/queries';
import { requireAuth } from '@/lib/auth/middleware';

export async function POST(request: Request) {
  try {
    // 1. Authentication Check
    const session = await requireAuth();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
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

    // 4. Fetch CURRENT stock from WooCommerce
    let currentWooStock = 0;
    try {
      const wooProduct = await getProduct(singleSku.woocommerce_product_id);
      currentWooStock = wooProduct.stock_quantity || 0;
    } catch (error) {
      console.error(`Failed to fetch current stock for ${sku} from WooCommerce`, error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch current stock from WooCommerce' },
        { status: 502 }
      );
    }

    // 5. Calculate New Quantity (always add for refund/return)
    const newQuantity = currentWooStock + qty;

    // 6. Update WooCommerce Stock (always restore stock regardless of condition)
    let singleSkuUpdated = false;
    try {
      await updateProductStock(singleSku.woocommerce_product_id, newQuantity);
      singleSkuUpdated = true;
      console.log(`✅ Updated single SKU ${sku} in WooCommerce (refund/return): ${newQuantity} units (condition: ${condition})`);
    } catch (error) {
      console.error(`❌ Failed to update single SKU ${sku} in WooCommerce:`, error);
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
        { success: false, error: 'Failed to update WooCommerce' },
        { status: 502 }
      );
    }

    // 7. Log to Database (Procurement History & Activity Log)
    try {
      const notesWithOrder = orderId 
        ? (notes ? `${notes} (Order #${orderId})` : `Order #${orderId}`)
        : notes;
      
      console.log(`📝 Logging refund/return to DB: SKU=${sku}, Condition=${condition}, Quantity=${qty}, UserId=${userId}`);
      const procurementRecord = await createProcurementUpdate({
        singleSkuId: singleSku.id,
        operation: 'add', // Always 'add' for refund/return
        quantity: qty,
        previousQuantity: currentWooStock,
        newQuantity,
        notes: notesWithOrder,
        returnCondition: condition as 'lost' | 'damaged' | 'good',
        createdBy: userId
      });
      console.log(`✅ Successfully logged refund/return: ID=${procurementRecord.id}, Condition=${condition}`);
    } catch (dbError: any) {
      console.error('❌ Failed to log refund/return to DB:', dbError);
      // Log error but don't fail the request since WC update succeeded
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

    // 8. Calculate and Update Combo SKUs
    const allCombos = await getAllComboSkus();
    const affectedCombos = allCombos.filter((c: any) =>
      c.components.some((comp: any) => comp.sku === sku)
    );

    const wooCommerceUpdates = [];

    if (affectedCombos.length > 0) {
      const neededSkus = new Set<string>();
      affectedCombos.forEach((c: any) => {
        c.components.forEach((comp: any) => neededSkus.add(comp.sku));
      });

      const allSingleSkus = await getAllSingleSkus();
      const skuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));

      const stockMap: Record<string, number> = {};
      stockMap[sku] = newQuantity;

      const missingSkus = Array.from(neededSkus).filter(s => s !== sku);

      await Promise.all(missingSkus.map(async (s) => {
        const sData = skuMap.get(s);
        if (sData) {
          try {
            const p = await getProduct(sData.woocommerce_product_id);
            stockMap[s] = p.stock_quantity || 0;
          } catch (e) {
            console.warn(`Failed to fetch stock for component ${s}`, e);
            stockMap[s] = 0;
          }
        }
      }));

      for (const combo of affectedCombos) {
        let comboLimit = Infinity;
        for (const comp of combo.components) {
          const compStock = stockMap[comp.sku] || 0;
          const canMake = Math.floor(compStock / comp.quantity);
          if (canMake < comboLimit) comboLimit = canMake;
        }
        if (comboLimit === Infinity) comboLimit = 0;

        try {
          await updateProductStock(combo.woocommerce_product_id, comboLimit);
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
      condition,
      newLocalQuantity: newQuantity,
      singleSkuUpdatedInWooCommerce: singleSkuUpdated,
      affectedComboSKUs: wooCommerceUpdates,
      message: `Refund/return processed successfully. Condition: ${condition.charAt(0).toUpperCase() + condition.slice(1)}. Stock restored.`
    });

  } catch (error) {
    console.error('Error in refund/return:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process refund/return' },
      { status: 500 }
    );
  }
}

