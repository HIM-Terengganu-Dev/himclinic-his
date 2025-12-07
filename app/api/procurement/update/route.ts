import { NextResponse } from 'next/server';
import { updateProductStock } from '@/lib/services/woocommerce';
import { SINGLE_SKUS } from '@/lib/data/single-skus';
import { calculateComboAvailability } from '@/lib/utils/inventory';
import { COMBO_SKUS } from '@/lib/data/combo-skus';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sku, quantity, operation } = body;

    if (!sku || quantity === undefined || !operation) {
      return NextResponse.json(
        { success: false, error: 'sku, quantity, and operation are required' },
        { status: 400 }
      );
    }

    // Find the single SKU
    const singleSku = SINGLE_SKUS.find((s) => s.sku === sku);
    if (!singleSku) {
      return NextResponse.json(
        { success: false, error: 'Invalid single SKU' },
        { status: 400 }
      );
    }

    let newQuantity: number;

    if (operation === 'add' || operation === 'set') {
      // Update in local inventory via the inventory API
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: operation, 
          sku, 
          quantity: operation === 'add' ? quantity : quantity 
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update local inventory');
      }

      const inventoryData = await response.json();
      newQuantity = inventoryData.singleSkus[sku];

      // Update the single SKU in WooCommerce (WRITE API)
      let singleSkuUpdated = false;
      try {
        await updateProductStock(singleSku.id, newQuantity);
        singleSkuUpdated = true;
        console.log(`✅ Updated single SKU ${sku} in WooCommerce: ${newQuantity} units`);
      } catch (error) {
        console.error(`❌ Failed to update single SKU ${sku} in WooCommerce:`, error);
      }

      // Calculate which combo SKUs need to be updated in WooCommerce
      const comboUpdates = [];
      for (const combo of COMBO_SKUS) {
        const maxAvailable = calculateComboAvailability(combo.sku, inventoryData.singleSkus);
        
        comboUpdates.push({
          sku: combo.sku,
          name: combo.name,
          id: combo.id,
          calculatedStock: maxAvailable,
        });
      }

      // Update WooCommerce for affected combo SKUs
      const wooCommerceUpdates = [];
      for (const update of comboUpdates) {
        try {
          await updateProductStock(update.id, update.calculatedStock);
          wooCommerceUpdates.push({
            sku: update.sku,
            name: update.name,
            newStock: update.calculatedStock,
          });
        } catch (error) {
          console.warn(`Failed to update WooCommerce stock for ${update.sku}:`, error);
        }
      }

      return NextResponse.json({
        success: true,
        sku,
        newLocalQuantity: newQuantity,
        singleSkuUpdatedInWooCommerce: singleSkuUpdated,
        affectedComboSKUs: wooCommerceUpdates,
        inventory: inventoryData.singleSkus,
        comboAvailability: inventoryData.comboAvailability,
      });
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid operation. Use add or set' },
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


