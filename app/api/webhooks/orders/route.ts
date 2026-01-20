import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { updateProductStock, getProduct } from '@/lib/services/woocommerce';
import { getAllComboSkus, getAllSingleSkus, logWcWebhook, getWcWebhookLogByOrderId, addPendingConsultationStock, removePendingConsultationStock } from '@/lib/db/queries';
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
        // Note: refunded orders do NOT automatically restore stock - staff must manually QC returned items first
        if (status === 'cancelled') {
            // Check if order was previously in pending-consult status
            // If so, just remove pending stock tracking and log (don't restore stock - payment was made, refund handled manually)
            const previousPendingConsultLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-consult');
            if (previousPendingConsultLog) {
                // Order was in pending-consult (payment made), now cancelled
                // Remove pending stock tracking but DON'T restore stock (refund handled manually via procurement tab)
                await removePendingConsultationStock(orderId);
                return await handlePendingConsultCancellation(orderId, payload, request);
            }
            // Otherwise, handle as normal cancellation (for orders that were in processing status)
            return await handleOrderCancellation(orderId, payload, request);
        }

        // Handle 'pending-consult' status (Pending Consultation): Track stock deducted by WC
        // WC reduces stock when payment is successful and order moves to "Pending Consultation"
        // We need to track this so dashboard shows (stock +X) where X is pending stock
        if (status === 'pending-consult') {
            return await handlePendingConsultation(orderId, payload, request);
        }

        // Only process 'processing' status orders (paid orders that need stock deduction)
        if (status !== 'processing') {
            return NextResponse.json({ success: true, message: `Order status is ${status}, skipping stock update` });
        }

        // Check if order was previously in pending-consult status
        // This helps us understand the context: WC already deducted stock (combo SKU or single SKU),
        // but for combo SKUs, components weren't deducted yet (HIS will deduct them now)
        const previousPendingConsultLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-consult');
        if (previousPendingConsultLog) {
            console.log(`📋 Order #${orderId} was previously in pending-consult - removing pending stock tracking before processing`);
            // Remove pending consultation stock tracking (WC already deducted, HIS will deduct components for combos if needed)
            await removePendingConsultationStock(orderId);
        }

        // Check if this order was already processed (idempotency protection)
        // Prevents double deduction if order goes: processing → pending → processing
        // BUT allows reprocessing if order was cancelled (stock was restored)
        const previousProcessingLog = await getWcWebhookLogByOrderId(orderId, 'order.processing');
        if (previousProcessingLog && previousProcessingLog.success) {
            // Check if order was cancelled after processing (stock was restored, so we can process again)
            const cancellationLog = await getWcWebhookLogByOrderId(orderId, 'order.cancelled');
            if (cancellationLog) {
                // Compare timestamps to see if cancellation happened after processing
                const processingTime = new Date(previousProcessingLog.created_at).getTime();
                const cancellationTime = new Date(cancellationLog.created_at).getTime();
                if (cancellationTime > processingTime) {
                    // Order was cancelled after processing - stock was restored, so we can process again
                    console.log(`✅ Order #${orderId} was previously processed but then cancelled (stock restored) - reprocessing`);
                } else {
                    // Cancellation happened before processing (shouldn't happen, but skip to be safe)
                    console.log(`⏭️ Order #${orderId} was already processed successfully - skipping duplicate processing to prevent double deduction`);
                    return NextResponse.json({ 
                        success: true, 
                        message: `Order #${orderId} was already processed - skipping duplicate processing to prevent double stock deduction`,
                        previousProcessingTime: previousProcessingLog.created_at
                    });
                }
            } else {
                // Order was already processed and not cancelled - skip to prevent double deduction
                console.log(`⏭️ Order #${orderId} was already processed successfully - skipping duplicate processing to prevent double deduction`);
                return NextResponse.json({ 
                    success: true, 
                    message: `Order #${orderId} was already processed - skipping duplicate processing to prevent double stock deduction`,
                    previousProcessingTime: previousProcessingLog.created_at
                });
            }
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
        const directSingleSkuOrders: Record<string, number> = {}; // Track SKUs directly ordered (WC-side)
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
                directSingleSkuOrders[sku] = (directSingleSkuOrders[sku] || 0) + quantity; // Track direct orders separately
                console.log(`✅ Found single SKU ${sku} in database, quantity: ${quantity} (WC already deducted)`);
            } 
            // Validate against database: Check if it's a combo SKU
            else if (comboSkuMap.has(sku)) {
                // Combo SKU: break down to component single SKUs and deduct them
                // IMPORTANT: WooCommerce does NOT deduct component stocks for combo SKUs.
                // HIS system must deduct ALL components, even if a component is also a standalone single SKU.
                // Example: "kom/tad5(30tab)+tad20(4tab)" is one combo SKU. When ordered, WC doesn't deduct
                // "tad20/4tab" even though it exists as a single SKU. HIS must deduct it as a combo component.
                const combo = comboSkuMap.get(sku);
                if (!combo) continue;

                comboSkusInOrder.push({ sku, quantity });

                const components = Array.isArray(combo.components) 
                    ? combo.components 
                    : JSON.parse(combo.components || '[]');

                // Calculate deductions for each component
                // All combo components are deducted by HIS (isWcSide: false), not WC
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
                    // Add to totalDeductions for tracking
                    totalDeductions[comp.sku] = (totalDeductions[comp.sku] || 0) + deductedQty;
                    
                    // Track component deduction - HIS will deduct these (not WC)
                    const componentSkuData = singleSkuMap.get(comp.sku);
                    if (componentSkuData && componentSkuData.woocommerce_product_id) {
                        singleSkuDeductions.push({
                            sku: comp.sku,
                            quantity: deductedQty,
                            wcProductId: componentSkuData.woocommerce_product_id
                        });
                    }
                }
                console.log(`✅ Found combo SKU ${sku} in database, breaking down to components - HIS will deduct component stocks (WC does not deduct combo components)`);
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
        // IMPORTANT: A SKU can be BOTH directly ordered AND a component of a combo.
        // In that case, the directly ordered quantity is WC-side, and the component quantity is HIS-side.
        // Use directSingleSkuOrders to identify which SKUs were directly ordered (regardless of whether they're also components)
        const directSingleSkus = Object.keys(directSingleSkuOrders);

        // Fetch current stock for direct single SKUs to calculate previous stock
        // Use directSingleSkuOrders[sku] instead of totalDeductions[sku] because:
        // - If SKU is only directly ordered: directSingleSkuOrders[sku] = totalDeductions[sku]
        // - If SKU is both directly ordered AND a component: directSingleSkuOrders[sku] = only the direct order quantity
        for (const sku of directSingleSkus) {
            const deductedQty = directSingleSkuOrders[sku]; // Only the directly ordered quantity (WC-side)
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
                    // Even if fetch fails, still track it as WC-side since WC already deducted it
                    // Use deductedQty as fallback for previousStock calculation
                    wcSideDeductions.push({
                        sku,
                        previousStock: deductedQty, // Fallback: assume previous was at least the deducted amount
                        newStock: 0, // Fallback: unknown current stock
                        deductedQty,
                        isWcSide: true
                    });
                    console.log(`⚠️ Tracked WC-side deduction for ${sku} with fallback values (fetch failed)`);
                }
            } else {
                // SKU not found in map or missing WC product ID - still track as WC-side
                console.warn(`⚠️ SKU ${sku} not found in singleSkuMap or missing WC product ID, but tracking as WC-side deduction`);
                wcSideDeductions.push({
                    sku,
                    previousStock: deductedQty, // Fallback
                    newStock: 0, // Fallback
                    deductedQty,
                    isWcSide: true
                });
            }
        }

        // Step 2: Deduct component single SKU stocks for combo SKU orders
        // WooCommerce doesn't know about component breakdown, so we need to deduct them
        // Note: If order was in pending-consult, WC already deducted the combo SKU stock itself,
        // but components were NOT deducted yet, so we still need to deduct components here (no double-deduction)
        const singleSkuUpdates: Array<{ sku: string; previousStock: number; newStock: number; isWcSide?: false }> = [];
        
        if (singleSkuDeductions.length > 0) {
            const wasPendingConsult = previousPendingConsultLog !== null;
            console.log(`Deducting component single SKU stocks for ${singleSkuDeductions.length} component deductions${wasPendingConsult ? ' (order was in pending-consult, components not deducted yet)' : ''}`);
            
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
                    // Get current stock from WC (actual stock, not including pending-consult)
                    // IMPORTANT: Always use actual WC stock for calculations and writes
                    const currentProduct = await getProduct(wcProductId);
                    const currentStock = currentProduct.stock_quantity || 0; // Actual WC stock
                    
                    // Calculate new stock (deduct)
                    const newStock = Math.max(0, currentStock - totalQty);
                    
                    // Update in WooCommerce with actual stock quantity (without pending-consult)
                    // WC is not aware of pending-consult, so we write the actual quantity
                    await updateProductStock(wcProductId, newStock); // Actual stock, not including pending-consult
                    
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
        console.log(`  - Direct single SKUs (WC-side): ${wcSideDeductions.length}`, wcSideDeductions.map(d => d.sku));
        if (comboSkusInOrder.length > 0) {
            console.log(`  - ${comboSkusInOrder.length} combo SKU(s) ordered (component stocks deducted)`);
        }
        if (singleSkuUpdates.length > 0) {
            console.log(`  - ${singleSkuUpdates.length} component single SKU(s) deducted by HIS system:`, singleSkuUpdates.map(d => d.sku));
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
                    // IMPORTANT: Write actual calculated combo availability (without pending-consult) to WC
                    // WC is not aware of pending-consult, so we write the actual calculated quantity
                    await updateProductStock(combo.woocommerce_product_id, comboLimit); // Actual stock, not including pending-consult
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
        // CRITICAL: If this fails, stock has already been deducted but won't be logged!
        // This is a known issue - stock changes happen before logging
        try {
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
                            isWcSide: true, // WC deducted, HIS only tracked (no write)
                            hisWrote: false // HIS did NOT write
                        })),
                        ...singleSkuUpdates.map(u => ({
                            sku: u.sku,
                            previousStock: u.previousStock,
                            newStock: u.newStock,
                            isWcSide: false, // HIS deducted (wrote)
                            hisWrote: true // HIS wrote this change
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
        } catch (logError: any) {
            // CRITICAL ERROR: Stock was already deducted but logging failed!
            // IMPORTANT: We do NOT rollback or auto-reconcile. Stock changes remain in WooCommerce.
            // Manual reconciliation is required by the user. We only log the error for detection.
            console.error(`❌ CRITICAL: Failed to log webhook for Order #${orderId} after stock was deducted!`, {
                error: logError.message,
                orderId,
                componentDeductions: singleSkuUpdates,
                wcSideDeductions: wcSideDeductions
            });
            
            // Try to log the error to activity_logs as a fallback
            // This allows users to detect unlogged stock changes and manually reconcile
            try {
                await import('@/lib/db/queries').then(m => m.logActivity({
                    action: 'webhook_log_failed_after_stock_deduction',
                    entityType: 'order',
                    entityId: orderId,
                    details: {
                        orderId,
                        error: logError.message,
                        componentDeductions: singleSkuUpdates,
                        wcSideDeductions: wcSideDeductions,
                        note: 'CRITICAL: Stock was deducted but webhook log failed. This creates unlogged stock changes! Manual reconciliation required.'
                    },
                    success: false,
                    errorMessage: `Webhook log failed after stock deduction: ${logError.message}`
                }));
            } catch (fallbackError) {
                console.error('❌ Failed to log error to activity_logs as fallback:', fallbackError);
            }
            
            // Still return success because stock was deducted (business operation succeeded)
            // Stock changes are NOT rolled back - manual reconciliation is required
        }

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
 * Handle pending-consult cancellation: Order was in pending-consult (payment made) but now cancelled
 * Remove pending stock tracking but DON'T restore stock (refund handled manually via procurement tab)
 */
async function handlePendingConsultCancellation(orderId: number, payload: any, request?: Request) {
    try {
        console.log(`📋 Processing pending-consult cancellation for Order #${orderId} (payment was made, refund handled manually)`);

        // Get line items from webhook payload
        const lineItems = payload.line_items;
        if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
            return NextResponse.json({ success: true, message: 'No line items in order' });
        }

        // Get SKU mappings from database
        const allSingleSkus = await getAllSingleSkus();
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));

        // Read current stock from WC for reporting (don't write/restore)
        const stockReadings: Array<{ sku: string; wcStock: number }> = [];

        for (const item of lineItems) {
            if (!item.sku) continue;
            
            const sku = item.sku;
            if (singleSkuMap.has(sku)) {
                const singleSku = singleSkuMap.get(sku);
                if (singleSku && singleSku.woocommerce_product_id) {
                    try {
                        const currentProduct = await getProduct(singleSku.woocommerce_product_id);
                        const currentStock = currentProduct.stock_quantity || 0;
                        stockReadings.push({ sku, wcStock: currentStock });
                    } catch (e: any) {
                        console.error(`❌ Failed to read stock for ${sku}:`, e.message);
                    }
                }
            }
        }

        // Get IP address and user agent from request
        const ipAddress = request?.headers.get('x-forwarded-for') || 
                         request?.headers.get('x-real-ip') || 
                         'unknown';
        const userAgent = request?.headers.get('user-agent') || 'unknown';

        // Extract SKUs from line items for logging
        const orderSkus = lineItems.map((item: any) => item.sku).filter(Boolean);
        const firstSku = orderSkus.length > 0 ? orderSkus[0] : undefined;

        // Log to WC Webhook Logs (read-only, no stock restoration)
        try {
            await logWcWebhook({
                webhookType: 'order',
                webhookEvent: `order.${payload.status}`,
                entityId: orderId,
                entityName: `Order #${orderId}`,
                entitySku: firstSku,
                status: payload.status,
                affectedSkus: orderSkus,
                details: {
                    orderId,
                    status: payload.status,
                    previousStatus: 'pending-consult',
                    lineItems: lineItems.map((item: any) => ({
                        sku: item.sku,
                        name: item.name,
                        quantity: item.quantity
                    })),
                    stockReadings: stockReadings,
                    note: 'Order cancelled from pending-consult status. Payment was made, so stock NOT auto-restored. Refund must be handled manually via procurement tab. Pending stock tracking removed.'
                },
                ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
                userAgent,
                success: true
            });
        } catch (logError: any) {
            console.error(`❌ Failed to log webhook for Order #${orderId}:`, logError.message);
        }

        return NextResponse.json({
            success: true,
            message: 'Pending-consult cancellation processed. Stock NOT restored (refund handled manually).',
            stockReadings: stockReadings.length
        });

    } catch (error: any) {
        console.error('Pending-Consult Cancellation Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

/**
 * Handle pending-consult status: Track stock deducted by WC for single SKU orders
 * WC reduces stock when payment is successful and order moves to "Pending Consultation"
 * We track this so dashboard can show (stock +X) where X is pending stock
 */
async function handlePendingConsultation(orderId: number, payload: any, request?: Request) {
    try {
        console.log(`📋 Processing pending-consult for Order #${orderId}`);

        // Get line items from webhook payload
        const lineItems = payload.line_items;
        if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
            return NextResponse.json({ success: true, message: 'No line items in order' });
        }

        // Get SKU mappings from database
        const allSingleSkus = await getAllSingleSkus();
        const allCombos = await getAllComboSkus();
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));
        const comboSkuMap = new Map(allCombos.map((c: any) => [c.sku, c]));

        // Track pending stock for both single SKU and combo SKU orders
        const pendingStockUpdates: Array<{ sku: string; quantity: number; wcStock: number; isCombo: boolean }> = [];

        for (const item of lineItems) {
            if (!item.sku) {
                console.warn(`⚠️ Order #${orderId} has line item without SKU: ${item.name || 'Unknown'}`);
                continue;
            }

            const sku = item.sku;
            const quantity = item.quantity || 0;

            // Process single SKU orders
            if (singleSkuMap.has(sku)) {
                const singleSku = singleSkuMap.get(sku);
                if (singleSku && singleSku.woocommerce_product_id) {
                    try {
                        // Read current stock from WooCommerce (WC already deducted it)
                        const currentProduct = await getProduct(singleSku.woocommerce_product_id);
                        const currentStock = currentProduct.stock_quantity || 0;
                        
                        // Store pending consultation stock
                        await addPendingConsultationStock(orderId, sku, quantity);
                        
                        pendingStockUpdates.push({
                            sku,
                            quantity,
                            wcStock: currentStock,
                            isCombo: false
                        });
                        
                        console.log(`✅ Tracked pending consultation stock for single SKU ${sku}: ${quantity} units (WC stock: ${currentStock})`);
                    } catch (e: any) {
                        console.error(`❌ Failed to track pending stock for ${sku}:`, e.message);
                    }
                }
            } else if (comboSkuMap.has(sku)) {
                // Combo SKU - track it (WC deducted combo SKU stock, but components not deducted yet)
                const combo = comboSkuMap.get(sku);
                if (combo && combo.woocommerce_product_id) {
                    try {
                        // Read current combo SKU stock from WooCommerce (WC already deducted it)
                        const currentProduct = await getProduct(combo.woocommerce_product_id);
                        const currentStock = currentProduct.stock_quantity || 0;
                        
                        // Store pending consultation stock for combo SKU
                        await addPendingConsultationStock(orderId, sku, quantity);
                        
                        pendingStockUpdates.push({
                            sku,
                            quantity,
                            wcStock: currentStock,
                            isCombo: true
                        });
                        
                        console.log(`✅ Tracked pending consultation stock for combo SKU ${sku}: ${quantity} units (WC stock: ${currentStock}, components not deducted yet)`);
                    } catch (e: any) {
                        console.error(`❌ Failed to track pending stock for combo SKU ${sku}:`, e.message);
                    }
                }
            } else {
                console.warn(`⚠️ SKU ${sku} from order #${orderId} not found in database`);
            }
        }

        if (pendingStockUpdates.length === 0) {
            return NextResponse.json({ success: true, message: 'No single SKUs found in order to track' });
        }

        // Get IP address and user agent from request
        const ipAddress = request?.headers.get('x-forwarded-for') || 
                         request?.headers.get('x-real-ip') || 
                         'unknown';
        const userAgent = request?.headers.get('user-agent') || 'unknown';

        // Extract SKUs from line items for logging
        const orderSkus = lineItems.map((item: any) => item.sku).filter(Boolean);
        const firstSku = orderSkus.length > 0 ? orderSkus[0] : undefined;

        // Log to WC Webhook Logs
        try {
            await logWcWebhook({
                webhookType: 'order',
                webhookEvent: `order.${payload.status}`,
                entityId: orderId,
                entityName: `Order #${orderId}`,
                entitySku: firstSku,
                status: payload.status,
                affectedSkus: orderSkus,
                details: {
                    orderId,
                    status: payload.status,
                    lineItems: lineItems.map((item: any) => ({
                        sku: item.sku,
                        name: item.name,
                        quantity: item.quantity
                    })),
                    pendingStockUpdates: pendingStockUpdates.map(u => ({
                        sku: u.sku,
                        quantity: u.quantity,
                        wcStock: u.wcStock,
                        isCombo: u.isCombo
                    })),
                    note: 'Order moved to Pending Consultation (pending-consult). WC deducted stock (combo SKU stock for combos, single SKU stock for singles). System tracking pending stock for dashboard display. For combo SKUs, components will be deducted when order moves to processing.'
                },
                ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
                userAgent,
                success: true
            });
        } catch (logError: any) {
            console.error(`❌ Failed to log webhook for Order #${orderId}:`, logError.message);
        }

        return NextResponse.json({
            success: true,
            message: 'Pending consultation stock tracked',
            pendingStockUpdates: pendingStockUpdates.length
        });

    } catch (error: any) {
        console.error('Pending Consultation Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

/**
 * Handle order cancellation: Restore stock that was deducted
 * Only restores stock if:
 * 1. Order was previously in "processing" status (stock was deducted)
 * 2. Order date is after January 1, 2026
 */
async function handleOrderCancellation(orderId: number, payload: any, request?: Request) {
    try {
        console.log(`🔄 Processing cancellation for Order #${orderId}`);

        // Check if order was previously in "processing" status (stock was deducted)
        const previousProcessingLog = await getWcWebhookLogByOrderId(orderId, 'order.processing');
        if (!previousProcessingLog) {
            console.log(`⏭️ Order #${orderId} was never in "processing" status - no stock to restore`);
            return NextResponse.json({ 
                success: true, 
                message: 'Order was never in processing status - no stock was deducted, skipping restoration' 
            });
        }

        // Check if order date is after January 1, 2026
        const orderDate = payload.date_created || payload.date_created_gmt;
        if (!orderDate) {
            console.warn(`⚠️ Order #${orderId} has no date_created - skipping restoration`);
            return NextResponse.json({ 
                success: true, 
                message: 'Order has no creation date - skipping restoration' 
            });
        }

        const orderDateObj = new Date(orderDate);
        const cutoffDate = new Date('2026-01-01T00:00:00Z');
        
        if (orderDateObj < cutoffDate) {
            console.log(`⏭️ Order #${orderId} created before Jan 1, 2026 (${orderDate}) - skipping restoration`);
            return NextResponse.json({ 
                success: true, 
                message: `Order created before Jan 1, 2026 - skipping restoration (order date: ${orderDate})` 
            });
        }

        console.log(`✅ Order #${orderId} meets restoration criteria: was in processing status and created after Jan 1, 2026`);

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
        // These are always restored by HIS system (since HIS deducted them for combo orders)
        const restoredUpdates: Array<{ sku: string; previousStock: number; newStock: number; restoredQty: number; changeMadeBy: 'HIS' }> = [];
        const wcSideRestorations: Array<{ sku: string; previousStock: number; newStock: number; restoredQty: number; changeMadeBy: 'HIS' | 'WC' }> = [];

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

                    // IMPORTANT: Write actual stock quantity (without pending-consult) to WC
                    // WC is not aware of pending-consult, so we write the actual quantity
                    await updateProductStock(wcProductId, newStock); // Actual stock, not including pending-consult

                    restoredUpdates.push({
                        sku,
                        previousStock: currentStock,
                        newStock,
                        restoredQty: totalQty,
                        changeMadeBy: 'HIS' // HIS system always restores combo component stocks
                    });

                    console.log(`✅ Restored ${totalQty} to ${sku} (${currentStock} → ${newStock})`);
                } catch (e: any) {
                    console.error(`❌ Failed to restore stock for component ${sku}:`, e.message);
                }
            }
        }

        // Step 2: Track single SKU stock restorations (WC handles these automatically)
        // For single SKU orders, WooCommerce automatically restores stock on cancellation
        // HIS system only needs to read and track what WC did - no updateProductStock() call needed
        const directSingleSkus = Object.keys(totalRestorations).filter(sku => {
            return !componentRestorations.some(r => r.sku === sku);
        });

        for (const sku of directSingleSkus) {
            const restoreQty = totalRestorations[sku];
            const singleSku = singleSkuMap.get(sku);
            if (singleSku && singleSku.woocommerce_product_id) {
                try {
                    // Get current stock from WooCommerce (WC already restored it)
                    const currentProduct = await getProduct(singleSku.woocommerce_product_id);
                    const currentStock = currentProduct.stock_quantity || 0;
                    
                    // Get previous stock from processing webhook log
                    let previousStockFromLog: number | null = null;
                    let originalChangeMadeBy: 'HIS' | 'WC' = 'WC'; // Default to WC for single SKU orders
                    
                    if (previousProcessingLog && previousProcessingLog.details) {
                        const details = typeof previousProcessingLog.details === 'string' 
                            ? JSON.parse(previousProcessingLog.details) 
                            : previousProcessingLog.details;
                        const componentDeductions = details.componentDeductions || [];
                        const deduction = componentDeductions.find((d: any) => d.sku === sku);
                        if (deduction) {
                            previousStockFromLog = deduction.previousStock;
                            // Determine who made the original deduction
                            originalChangeMadeBy = deduction.isWcSide === true ? 'WC' : 'HIS';
                        }
                    }
                    
                    // Calculate what the stock was before WC restored it
                    const stockBeforeRestore = previousStockFromLog !== null 
                        ? previousStockFromLog 
                        : currentStock - restoreQty;
                    
                    // Calculate actual restoration quantity
                    const actualRestoredQty = currentStock - stockBeforeRestore;
                    
                    // Only log if there was an actual change (restoredQty > 0)
                    // If WC didn't restore (e.g., 80 → 80), there's no change to track
                    if (actualRestoredQty > 0) {
                        // WC already restored the stock - just track it
                        // No updateProductStock() call needed for single SKU orders
                        const changeMadeBy = 'WC'; // WC handles restoration for single SKU orders
                        const actualPreviousStock = stockBeforeRestore;
                        const actualNewStock = currentStock;
                        
                        console.log(`📝 WC restored ${actualRestoredQty} to ${sku} (${actualPreviousStock} → ${actualNewStock}) - WC made change (single SKU order)`);
                        
                        wcSideRestorations.push({
                            sku,
                            previousStock: actualPreviousStock,
                            newStock: actualNewStock,
                            restoredQty: actualRestoredQty,
                            changeMadeBy: changeMadeBy, // WC made the restoration
                            originalDeductionBy: originalChangeMadeBy // Who made the original deduction
                        } as any);
                    } else {
                        console.log(`⏭️ Skipping log for ${sku}: No restoration occurred (${stockBeforeRestore} → ${currentStock}, restoredQty: ${actualRestoredQty})`);
                    }

                } catch (e: any) {
                    console.error(`❌ Failed to read stock for ${sku}:`, e.message);
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
                    // IMPORTANT: Write actual calculated combo availability (without pending-consult) to WC
                    // WC is not aware of pending-consult, so we write the actual calculated quantity
                    await updateProductStock(combo.woocommerce_product_id, comboLimit); // Actual stock, not including pending-consult
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

        try {
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
                            changeMadeBy: r.changeMadeBy, // Who made the restoration (always 'WC' for single SKUs)
                            originalDeductionBy: (r as any).originalDeductionBy || 'WC', // Who made the original deduction
                            isWcSide: true, // WC restored, HIS only tracked (no write)
                            hisWrote: false // HIS did NOT write
                        })),
                        ...restoredUpdates.map(r => ({
                            sku: r.sku,
                            previousStock: r.previousStock,
                            newStock: r.newStock,
                            restoredQty: r.restoredQty,
                            changeMadeBy: r.changeMadeBy, // Always 'HIS' for combo components
                            originalDeductionBy: 'HIS', // Combo components are always deducted by HIS
                            isWcSide: false, // HIS restored (wrote)
                            hisWrote: true // HIS wrote this change
                        }))
                    ],
                    comboUpdates: comboUpdates.map(u => ({ sku: u.sku, newStock: u.newStock })),
                    note: comboSkusInOrder.length > 0
                        ? 'Order cancelled. HIS system restored component single SKU stocks (from combo orders) and updated combo availability. Single SKU stocks restored by WC.'
                        : 'Order cancelled. Single SKU stocks restored by WC automatically. System updated combo SKU availability.'
                },
                ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
                userAgent,
                success: true
            });
        } catch (logError: any) {
            // CRITICAL ERROR: Stock was already restored but logging failed!
            // IMPORTANT: We do NOT rollback or auto-reconcile. Stock restorations remain in WooCommerce.
            // Manual reconciliation is required by the user. We only log the error for detection.
            console.error(`❌ CRITICAL: Failed to log cancellation webhook for Order #${orderId} after stock was restored!`, {
                error: logError.message,
                orderId,
                componentRestorations: restoredUpdates,
                wcSideRestorations: wcSideRestorations
            });
            
            // Try to log the error to activity_logs as a fallback
            // This allows users to detect unlogged stock changes and manually reconcile
            try {
                await import('@/lib/db/queries').then(m => m.logActivity({
                    action: 'webhook_log_failed_after_stock_restoration',
                    entityType: 'order',
                    entityId: orderId,
                    details: {
                        orderId,
                        error: logError.message,
                        componentRestorations: restoredUpdates,
                        wcSideRestorations: wcSideRestorations,
                        note: 'CRITICAL: Stock was restored but webhook log failed. This creates unlogged stock changes! Manual reconciliation required.'
                    },
                    success: false,
                    errorMessage: `Cancellation webhook log failed after stock restoration: ${logError.message}`
                }));
            } catch (fallbackError) {
                console.error('❌ Failed to log error to activity_logs as fallback:', fallbackError);
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Order cancellation processed: Stock restored',
            restoredComponents: restoredUpdates.length, // Combo component stocks restored by HIS
            restoredSingleSkus: wcSideRestorations.length, // Single SKU stocks restored by WC (tracked only)
            comboUpdates: comboUpdates.length
        });

    } catch (error: any) {
        console.error('Order Cancellation Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
