import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { updateProductStock, getProduct } from '@/lib/services/woocommerce';
import { getAllComboSkus, getAllSingleSkus, logWcWebhook, getWcWebhookLogByOrderId } from '@/lib/db/queries';
import { deductComboSKU } from '@/lib/utils/inventory';

export async function POST(request: Request) {
    console.log("!!! WEBHOOK HIT !!! Method:", request.method);
    try {
        const bodyText = await request.text();

        // Debug: Log all headers to find the signature
        const headersList = Object.fromEntries(request.headers.entries());
        console.log('Webhook Headers:', JSON.stringify(headersList, null, 2));

        const signature = request.headers.get('x-wc-webhook-signature') || request.headers.get('X-WC-Webhook-Signature');
        const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;

        if (!secret || !signature) {
            console.error('Webhook Error: Missing secret or signature', {
                hasSecret: !!secret,
                hasSignature: !!signature
            });
            return NextResponse.json({ error: 'Missing secret or signature' }, { status: 401 });
        }

        // Verify Signature
        const hash = crypto.createHmac('sha256', secret).update(bodyText).digest('base64');

        if (hash !== signature) {
            console.error('Webhook Error: Invalid signature', {
                received: signature,
                computed: hash,
                secretLength: secret.length
            });
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        const payload = JSON.parse(bodyText);
        const orderId = payload.id;
        const status = payload.status;

        // Handle order cancellation: restore stock
        if (status === 'cancelled' || status === 'refunded') {
            return await handleOrderCancellation(orderId, payload, request);
        }

        // Only process 'processing' status orders (paid orders that need stock deduction)
        if (status !== 'processing') {
            return NextResponse.json({ success: true, message: `Order status is ${status}, skipping stock update` });
        }

        // Get all line items from webhook payload
        // WooCommerce webhook includes line_items in the payload
        const lineItems = payload.line_items;
        if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
            return NextResponse.json({ success: true, message: 'No line items in order' });
        }

        // Get SKU mappings from database (source of truth)
        const allSingleSkus = await getAllSingleSkus();
        const allCombos = await getAllComboSkus();
        
        // Create maps for quick lookup
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));
        const comboSkuMap = new Map(allCombos.map((c: any) => [c.sku, c]));

        // Track what needs to be deducted
        // For combo SKUs, we need to manually deduct component single SKUs
        // For direct single SKU orders, WooCommerce already deducted them
        const totalDeductions: Record<string, number> = {};
        const singleSkuDeductions: Array<{ sku: string; quantity: number; wcProductId: number }> = [];
        const comboSkusInOrder: Array<{ sku: string; quantity: number }> = [];

        for (const item of lineItems) {
            if (!item.sku) {
                console.warn(`⚠️ Order #${orderId} has line item without SKU: ${item.name || 'Unknown'}`);
                continue;
            }

            const sku = item.sku;
            const quantity = item.quantity || 0;

            // Validate against database: Check if it's a single SKU
            if (singleSkuMap.has(sku)) {
                // Direct single SKU order: WooCommerce already deducted stock
                totalDeductions[sku] = (totalDeductions[sku] || 0) + quantity;
                console.log(`✅ Found single SKU ${sku} in database, quantity: ${quantity} (WC already deducted)`);
            } 
            // Validate against database: Check if it's a combo SKU
            else if (comboSkuMap.has(sku)) {
                // Combo SKU: break down to component single SKUs and deduct them
                const combo = comboSkuMap.get(sku);
                if (!combo) continue;

                comboSkusInOrder.push({ sku, quantity });

                const components = Array.isArray(combo.components) 
                    ? combo.components 
                    : JSON.parse(combo.components || '[]');

                // Calculate deductions for each component
                for (const comp of components) {
                    if (!comp.sku || !comp.quantity) {
                        console.warn(`⚠️ Invalid component in combo ${sku}:`, comp);
                        continue;
                    }

                    // Validate component SKU exists in database
                    if (!singleSkuMap.has(comp.sku)) {
                        console.warn(`⚠️ Component SKU ${comp.sku} from combo ${sku} not found in database`);
                        continue;
                    }

                    const deductedQty = comp.quantity * quantity;
                    totalDeductions[comp.sku] = (totalDeductions[comp.sku] || 0) + deductedQty;
                    
                    // Track component deduction for WooCommerce update
                    const componentSkuData = singleSkuMap.get(comp.sku);
                    if (componentSkuData && componentSkuData.woocommerce_product_id) {
                        singleSkuDeductions.push({
                            sku: comp.sku,
                            quantity: deductedQty,
                            wcProductId: componentSkuData.woocommerce_product_id
                        });
                    }
                }
                console.log(`✅ Found combo SKU ${sku} in database, breaking down to components - will deduct component stocks`);
            } 
            else {
                // SKU not found in database - skip it
                console.warn(`⚠️ SKU ${sku} from order #${orderId} not found in database (not a single or combo SKU)`);
            }
        }

        if (Object.keys(totalDeductions).length === 0) {
            return NextResponse.json({ success: true, message: 'No valid SKUs found in order' });
        }

        // Step 1: Track WC-side deductions for direct single SKU orders
        // WooCommerce already deducted these, but we need to track them for display
        const wcSideDeductions: Array<{ sku: string; previousStock: number; newStock: number; deductedQty: number; isWcSide: true }> = [];
        
        // Track single SKUs that were directly ordered (not components of combos)
        const directSingleSkus = Object.keys(totalDeductions).filter(sku => {
            // Skip SKUs that are components (they'll be in singleSkuDeductions)
            return !singleSkuDeductions.some(d => d.sku === sku);
        });

        // Fetch current stock for direct single SKUs to calculate previous stock
        for (const sku of directSingleSkus) {
            const deductedQty = totalDeductions[sku];
            const singleSku = singleSkuMap.get(sku);
            if (singleSku && singleSku.woocommerce_product_id) {
                try {
                    const currentProduct = await getProduct(singleSku.woocommerce_product_id);
                    const currentStock = currentProduct.stock_quantity || 0; // Current stock (after WC deduction)
                    const previousStock = currentStock + deductedQty; // Calculate previous stock
                    
                    wcSideDeductions.push({
                        sku,
                        previousStock,
                        newStock: currentStock,
                        deductedQty,
                        isWcSide: true
                    });
                    
                    console.log(`📝 Tracked WC-side deduction for ${sku}: ${previousStock} → ${currentStock} (deducted ${deductedQty})`);
                } catch (e: any) {
                    console.error(`❌ Failed to fetch stock for WC-side deduction tracking ${sku}:`, e.message);
                }
            }
        }

        // Step 2: Deduct component single SKU stocks for combo SKU orders
        // WooCommerce doesn't know about component breakdown, so we need to deduct them
        const singleSkuUpdates: Array<{ sku: string; previousStock: number; newStock: number; isWcSide?: false }> = [];
        
        if (singleSkuDeductions.length > 0) {
            console.log(`Deducting component single SKU stocks for ${singleSkuDeductions.length} component deductions`);
            
            // Group deductions by SKU (in case multiple combos use same component)
            const deductionMap = new Map<string, number>();
            const wcIdMap = new Map<string, number>();
            
            for (const deduction of singleSkuDeductions) {
                deductionMap.set(deduction.sku, (deductionMap.get(deduction.sku) || 0) + deduction.quantity);
                wcIdMap.set(deduction.sku, deduction.wcProductId);
            }

            // Deduct each component SKU in WooCommerce
            for (const [sku, totalQty] of deductionMap.entries()) {
                const wcProductId = wcIdMap.get(sku);
                if (!wcProductId) continue;

                try {
                    // Get current stock
                    const currentProduct = await getProduct(wcProductId);
                    const currentStock = currentProduct.stock_quantity || 0;
                    
                    // Calculate new stock (deduct)
                    const newStock = Math.max(0, currentStock - totalQty);
                    
                    // Update in WooCommerce
                    await updateProductStock(wcProductId, newStock);
                    
                    singleSkuUpdates.push({
                        sku,
                        previousStock: currentStock,
                        newStock,
                        isWcSide: false
                    });
                    
                    console.log(`✅ Deducted ${totalQty} from ${sku} (${currentStock} → ${newStock})`);
                } catch (e: any) {
                    console.error(`❌ Failed to deduct stock for component ${sku}:`, e.message);
                }
            }
        }

        console.log(`Processing webhook for Order #${orderId}: Affected ${Object.keys(totalDeductions).length} single SKUs`);
        if (comboSkusInOrder.length > 0) {
            console.log(`  - ${comboSkusInOrder.length} combo SKU(s) ordered (component stocks deducted)`);
        }
        if (singleSkuUpdates.length > 0) {
            console.log(`  - ${singleSkuUpdates.length} component single SKU(s) deducted in WooCommerce`);
        }

        // Step 2: Recalculate and update combo SKU availability in WooCommerce
        // Find all combos that use the affected single SKUs (including those we just deducted)
        const affectedCombos = allCombos.filter((c: any) => {
            const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
            return components.some((comp: any) => Object.keys(totalDeductions).includes(comp.sku));
        });

        const comboUpdates: Array<{ sku: string; newStock: number }> = [];

        if (affectedCombos.length > 0) {
            console.log(`Recalculating ${affectedCombos.length} affected combo SKU(s)`);
            
            // Build stock map: fetch current stock from WooCommerce (after deductions)
            const stockMap: Record<string, number> = {};

            // Use updated stock from singleSkuUpdates if available, otherwise fetch from WC
            for (const update of singleSkuUpdates) {
                stockMap[update.sku] = update.newStock; // Use the stock we just updated
            }

            // Get current stock for all affected single SKUs
            for (const [sku] of Object.entries(totalDeductions)) {
                // Skip if we already have it from singleSkuUpdates
                if (stockMap.hasOwnProperty(sku)) continue;
                
                const singleSku = singleSkuMap.get(sku);
                if (singleSku && singleSku.woocommerce_product_id) {
                    try {
                        const p = await getProduct(singleSku.woocommerce_product_id);
                        stockMap[sku] = p.stock_quantity || 0; // Current stock (WC deducted for direct orders)
                    } catch (e) {
                        console.warn(`Failed to fetch current stock for ${sku}`, e);
                        stockMap[sku] = 0;
                    }
                }
            }

            // Fetch stock for other components needed for combo calculations
            const neededSkus = new Set<string>();
            affectedCombos.forEach((c: any) => {
                const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
                components.forEach((comp: any) => neededSkus.add(comp.sku));
            });

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
            for (const combo of affectedCombos) {
                if (!combo.woocommerce_product_id) {
                    console.warn(`⚠️ Combo ${combo.sku} missing WooCommerce product ID`);
                    continue;
                }

                const components = Array.isArray(combo.components) ? combo.components : JSON.parse(combo.components || '[]');
                let comboLimit = Infinity;

                for (const comp of components) {
                    const stock = stockMap[comp.sku] || 0;
                    const canMake = Math.floor(stock / comp.quantity);
                    if (canMake < comboLimit) comboLimit = canMake;
                }

                if (comboLimit === Infinity) comboLimit = 0;

                try {
                    await updateProductStock(combo.woocommerce_product_id, comboLimit);
                    comboUpdates.push({ sku: combo.sku, newStock: comboLimit });
                    console.log(`✅ Updated combo ${combo.sku} in WooCommerce: ${comboLimit} units`);
                } catch (e: any) {
                    console.error(`❌ Failed to update combo ${combo.sku} in WooCommerce:`, e.message);
                }
            }
        }

        // Get IP address and user agent from request
        const ipAddress = request.headers.get('x-forwarded-for') || 
                         request.headers.get('x-real-ip') || 
                         'unknown';
        const userAgent = request.headers.get('user-agent') || 'unknown';

        // Extract SKUs from line items for logging
        const orderSkus = lineItems.map((item: any) => item.sku).filter(Boolean);
        
        // Get the first SKU for display purposes (if available)
        const firstSku = orderSkus.length > 0 ? orderSkus[0] : undefined;
        
        // Calculate total quantity for display (sum of all line items)
        const totalQuantity = lineItems.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
        
        // Log to WC Webhook Logs
        await logWcWebhook({
            webhookType: 'order',
            webhookEvent: `order.${status}`,
            entityId: orderId,
            entityName: `Order #${orderId}`,
            entitySku: firstSku, // Show first SKU in order for display
            status: status,
            affectedSkus: orderSkus,
            comboUpdates: comboUpdates.map(u => ({ 
                sku: u.sku, 
                newStock: u.newStock 
            })),
            details: { 
                orderId, 
                status,
                lineItems: lineItems.map((item: any) => ({
                    sku: item.sku,
                    name: item.name,
                    quantity: item.quantity
                })),
                comboSkusOrdered: comboSkusInOrder,
                componentDeductions: [
                    ...wcSideDeductions.map(u => ({
                        sku: u.sku,
                        previousStock: u.previousStock,
                        newStock: u.newStock,
                        deductedQty: u.deductedQty,
                        isWcSide: true
                    })),
                    ...singleSkuUpdates.map(u => ({
                        sku: u.sku,
                        previousStock: u.previousStock,
                        newStock: u.newStock,
                        isWcSide: false
                    }))
                ],
                affectedSingleSkus: Object.keys(totalDeductions),
                note: comboSkusInOrder.length > 0 
                    ? 'Combo SKU(s) ordered. System deducted component single SKU stocks and updated combo availability.'
                    : 'Single SKU(s) ordered. WooCommerce deducted stock. System updated combo SKU availability.'
            },
            ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
            userAgent,
            success: true
        });

        return NextResponse.json({ 
            success: true, 
            message: comboSkusInOrder.length > 0
                ? 'Combo SKU order processed: Component single SKU stocks deducted and combo availability updated.'
                : 'Single SKU order processed: WooCommerce deducted stock and combo availability updated.',
            affectedSingleSkus: Object.keys(totalDeductions).length,
            componentDeductions: singleSkuUpdates.length,
            comboUpdates: comboUpdates.length
        });

    } catch (error) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * Handle order cancellation: Restore stock that was deducted
 */
async function handleOrderCancellation(orderId: number, payload: any, request?: Request) {
    try {
        console.log(`🔄 Processing cancellation for Order #${orderId}`);

        // Get line items from cancelled order
        const lineItems = payload.line_items;
        if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
            return NextResponse.json({ success: true, message: 'No line items in cancelled order' });
        }

        // Get SKU mappings
        const allSingleSkus = await getAllSingleSkus();
        const allCombos = await getAllComboSkus();
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));
        const comboSkuMap = new Map(allCombos.map((c: any) => [c.sku, c]));

        // Track what needs to be restored
        const totalRestorations: Record<string, number> = {};
        const componentRestorations: Array<{ sku: string; quantity: number; wcProductId: number }> = [];
        const comboSkusInOrder: Array<{ sku: string; quantity: number }> = [];

        // Process line items to calculate what needs to be restored
        for (const item of lineItems) {
            if (!item.sku) continue;
            
            const sku = item.sku;
            const quantity = item.quantity || 0;

            if (singleSkuMap.has(sku)) {
                // Direct single SKU order: Restore stock (WC might have already done this, but we'll do it too)
                totalRestorations[sku] = (totalRestorations[sku] || 0) + quantity;
            } else if (comboSkuMap.has(sku)) {
                // Combo SKU: Break down to components and restore them
                const combo = comboSkuMap.get(sku);
                if (!combo) continue;

                comboSkusInOrder.push({ sku, quantity });

                const components = Array.isArray(combo.components) 
                    ? combo.components 
                    : JSON.parse(combo.components || '[]');

                for (const comp of components) {
                    if (!comp.sku || !comp.quantity) continue;
                    if (!singleSkuMap.has(comp.sku)) continue;

                    const restoreQty = comp.quantity * quantity;
                    totalRestorations[comp.sku] = (totalRestorations[comp.sku] || 0) + restoreQty;
                    
                    const componentSkuData = singleSkuMap.get(comp.sku);
                    if (componentSkuData && componentSkuData.woocommerce_product_id) {
                        componentRestorations.push({
                            sku: comp.sku,
                            quantity: restoreQty,
                            wcProductId: componentSkuData.woocommerce_product_id
                        });
                    }
                }
            }
        }

        if (Object.keys(totalRestorations).length === 0) {
            return NextResponse.json({ success: true, message: 'No valid SKUs to restore in cancelled order' });
        }

        // Step 1: Restore stock for component single SKUs (combo orders)
        const restoredUpdates: Array<{ sku: string; previousStock: number; newStock: number; restoredQty: number }> = [];
        const wcSideRestorations: Array<{ sku: string; previousStock: number; newStock: number; restoredQty: number }> = [];

        // Restore combo component stocks (HIS system deducted these)
        if (componentRestorations.length > 0) {
            console.log(`Restoring ${componentRestorations.length} component stocks for combo SKU cancellation`);

            const restorationMap = new Map<string, number>();
            const wcIdMap = new Map<string, number>();

            for (const restoration of componentRestorations) {
                restorationMap.set(restoration.sku, (restorationMap.get(restoration.sku) || 0) + restoration.quantity);
                wcIdMap.set(restoration.sku, restoration.wcProductId);
            }

            for (const [sku, totalQty] of restorationMap.entries()) {
                const wcProductId = wcIdMap.get(sku);
                if (!wcProductId) continue;

                try {
                    const currentProduct = await getProduct(wcProductId);
                    const currentStock = currentProduct.stock_quantity || 0;
                    const newStock = currentStock + totalQty; // Restore stock

                    await updateProductStock(wcProductId, newStock);

                    restoredUpdates.push({
                        sku,
                        previousStock: currentStock,
                        newStock,
                        restoredQty: totalQty
                    });

                    console.log(`✅ Restored ${totalQty} to ${sku} (${currentStock} → ${newStock})`);
                } catch (e: any) {
                    console.error(`❌ Failed to restore stock for component ${sku}:`, e.message);
                }
            }
        }

        // Step 2: Restore direct single SKU stocks (WC-side)
        const directSingleSkus = Object.keys(totalRestorations).filter(sku => {
            return !componentRestorations.some(r => r.sku === sku);
        });

        for (const sku of directSingleSkus) {
            const restoreQty = totalRestorations[sku];
            const singleSku = singleSkuMap.get(sku);
            if (singleSku && singleSku.woocommerce_product_id) {
                try {
                    const currentProduct = await getProduct(singleSku.woocommerce_product_id);
                    const currentStock = currentProduct.stock_quantity || 0;
                    const newStock = currentStock + restoreQty; // Restore stock

                    await updateProductStock(singleSku.woocommerce_product_id, newStock);

                    wcSideRestorations.push({
                        sku,
                        previousStock: currentStock,
                        newStock,
                        restoredQty: restoreQty
                    });

                    console.log(`✅ Restored ${restoreQty} to ${sku} (${currentStock} → ${newStock}) - WC side`);
                } catch (e: any) {
                    console.error(`❌ Failed to restore stock for ${sku}:`, e.message);
                }
            }
        }

        // Step 3: Recalculate combo SKU availability after restoration
        const affectedCombos = allCombos.filter((c: any) => {
            const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
            return components.some((comp: any) => Object.keys(totalRestorations).includes(comp.sku));
        });

        const comboUpdates: Array<{ sku: string; newStock: number }> = [];

        if (affectedCombos.length > 0) {
            console.log(`Recalculating ${affectedCombos.length} combo SKU(s) after cancellation restoration`);

            const stockMap: Record<string, number> = {};

            // Use restored stock values
            for (const update of [...restoredUpdates, ...wcSideRestorations]) {
                stockMap[update.sku] = update.newStock;
            }

            // Fetch current stock for other components
            for (const [sku] of Object.entries(totalRestorations)) {
                if (stockMap.hasOwnProperty(sku)) continue;

                const singleSku = singleSkuMap.get(sku);
                if (singleSku && singleSku.woocommerce_product_id) {
                    try {
                        const p = await getProduct(singleSku.woocommerce_product_id);
                        stockMap[sku] = p.stock_quantity || 0;
                    } catch (e) {
                        stockMap[sku] = 0;
                    }
                }
            }

            // Fetch stock for other components needed for combo calculations
            const neededSkus = new Set<string>();
            affectedCombos.forEach((c: any) => {
                const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
                components.forEach((comp: any) => neededSkus.add(comp.sku));
            });

            const missingSkus = Array.from(neededSkus).filter(s => !stockMap.hasOwnProperty(s));
            await Promise.all(missingSkus.map(async (s) => {
                const sData = singleSkuMap.get(s);
                if (sData && sData.woocommerce_product_id) {
                    try {
                        const p = await getProduct(sData.woocommerce_product_id);
                        stockMap[s] = p.stock_quantity || 0;
                    } catch (e) {
                        stockMap[s] = 0;
                    }
                }
            }));

            // Calculate and update combo stock
            for (const combo of affectedCombos) {
                if (!combo.woocommerce_product_id) continue;

                const components = Array.isArray(combo.components) ? combo.components : JSON.parse(combo.components || '[]');
                let comboLimit = Infinity;

                for (const comp of components) {
                    const stock = stockMap[comp.sku] || 0;
                    const canMake = Math.floor(stock / comp.quantity);
                    if (canMake < comboLimit) comboLimit = canMake;
                }

                if (comboLimit === Infinity) comboLimit = 0;

                try {
                    await updateProductStock(combo.woocommerce_product_id, comboLimit);
                    comboUpdates.push({ sku: combo.sku, newStock: comboLimit });
                    console.log(`✅ Updated combo ${combo.sku} after cancellation: ${comboLimit} units`);
                } catch (e: any) {
                    console.error(`❌ Failed to update combo ${combo.sku}:`, e.message);
                }
            }
        }

        // Step 4: Log the cancellation
        let ipAddress = 'unknown';
        let userAgent = 'unknown';
        if (request) {
            ipAddress = request.headers.get('x-forwarded-for') || 
                       request.headers.get('x-real-ip') || 
                       'unknown';
            userAgent = request.headers.get('user-agent') || 'unknown';
        }
        const orderSkus = lineItems.map((item: any) => item.sku).filter(Boolean);
        const firstSku = orderSkus.length > 0 ? orderSkus[0] : undefined;

        await logWcWebhook({
            webhookType: 'order',
            webhookEvent: `order.${payload.status}`,
            entityId: orderId,
            entityName: `Order #${orderId}`,
            entitySku: firstSku,
            status: payload.status,
            affectedSkus: orderSkus,
            comboUpdates: comboUpdates.map(u => ({ sku: u.sku, newStock: u.newStock })),
            details: {
                orderId,
                status: payload.status,
                lineItems: lineItems.map((item: any) => ({
                    sku: item.sku,
                    name: item.name,
                    quantity: item.quantity
                })),
                comboSkusCancelled: comboSkusInOrder,
                componentRestorations: [
                    ...wcSideRestorations.map(r => ({
                        sku: r.sku,
                        previousStock: r.previousStock,
                        newStock: r.newStock,
                        restoredQty: r.restoredQty,
                        isWcSide: true
                    })),
                    ...restoredUpdates.map(r => ({
                        sku: r.sku,
                        previousStock: r.previousStock,
                        newStock: r.newStock,
                        restoredQty: r.restoredQty,
                        isWcSide: false
                    }))
                ],
                comboUpdates: comboUpdates.map(u => ({ sku: u.sku, newStock: u.newStock })),
                note: comboSkusInOrder.length > 0
                    ? 'Order cancelled. System restored component single SKU stocks and updated combo availability.'
                    : 'Order cancelled. Stock restored (WC side). System updated combo SKU availability.'
            },
            ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
            userAgent,
            success: true
        });

        return NextResponse.json({
            success: true,
            message: 'Order cancellation processed: Stock restored',
            restoredComponents: restoredUpdates.length,
            restoredSingleSkus: wcSideRestorations.length,
            comboUpdates: comboUpdates.length
        });

    } catch (error: any) {
        console.error('Order Cancellation Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
