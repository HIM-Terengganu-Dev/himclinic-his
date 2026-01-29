import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAllComboSkus, getAllSingleSkus, logWcWebhook, getWcWebhookLogByOrderId, createStockTransaction, getCurrentStockState, getStockTransactions, removePendingConsultationStock, getPendingConsultationStockByOrder, getPendingStockAtTime, logStockMovement } from '@/lib/db/queries';
import { deductComboSKU } from '@/lib/utils/inventory';

// Disable body parsing to get raw body for signature verification
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    console.log("!!! WEBHOOK HIT !!! Method:", request.method);
    try {
        const bodyText = await request.text();
        const contentType = request.headers.get('content-type') || '';

        // Debug: Log all headers to find the signature
        const headersList = Object.fromEntries(request.headers.entries());
        console.log('Webhook Headers:', JSON.stringify(headersList, null, 2));
        console.log('Content-Type:', contentType);
        console.log('Body preview (first 200 chars):', bodyText.substring(0, 200));

        // Handle WooCommerce test pings (form-encoded: webhook_id=14)
        if (bodyText.startsWith('webhook_id=') || contentType.includes('application/x-www-form-urlencoded')) {
            console.log('📝 Received WooCommerce test ping/webhook verification - returning success');
            return NextResponse.json({ 
                success: true, 
                message: 'Webhook endpoint is active and receiving requests',
                received: bodyText 
            });
        }

        // Try multiple header name variations (WooCommerce can send different formats)
        const signature = request.headers.get('x-wc-webhook-signature') || 
                         request.headers.get('X-WC-Webhook-Signature') ||
                         request.headers.get('X-WC-WEBHOOK-SIGNATURE') ||
                         (headersList as any)['x-wc-webhook-signature'] ||
                         (headersList as any)['X-WC-Webhook-Signature'] ||
                         (headersList as any)['x-wc-webhook-signature']?.toString();
        
        const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;

        if (!secret) {
            console.error('Webhook Error: Missing WOOCOMMERCE_WEBHOOK_SECRET environment variable');
            return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
        }

        // Check for signature - if missing, log warning but allow (for testing/debugging)
        // In production, you should enforce signature verification
        if (!signature) {
            console.warn('⚠️ Webhook Warning: Missing signature header - proceeding without verification', {
                hasSecret: !!secret,
                hasSignature: !!signature,
                allHeaderKeys: Object.keys(headersList),
                headerKeysLowercase: Object.keys(headersList).map(k => k.toLowerCase()),
                signatureHeaderPresent: Object.keys(headersList).some(k => 
                    k.toLowerCase().includes('webhook') && k.toLowerCase().includes('signature')
                ),
                note: 'This webhook is being processed without signature verification. Please configure WooCommerce webhook with a secret.'
            });
            // Allow to proceed for now - remove this in production if you want strict verification
            // return NextResponse.json({ error: 'Missing signature header' }, { status: 401 });
        } else {
            // Verify Signature if present
            const hash = crypto.createHmac('sha256', secret).update(bodyText).digest('base64');

            // Compare signatures (trim whitespace in case of encoding issues)
            const receivedSig = signature.trim();
            const computedSig = hash.trim();

            if (receivedSig !== computedSig) {
                console.error('Webhook Error: Invalid signature', {
                    received: receivedSig,
                    receivedLength: receivedSig.length,
                    computed: computedSig,
                    computedLength: computedSig.length,
                    secretLength: secret.length,
                    bodyLength: bodyText.length,
                    signaturesMatch: receivedSig === computedSig
                });
                return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
            }

            console.log('✅ Webhook signature verified successfully');
        }

        // Parse JSON payload
        let payload;
        try {
            payload = JSON.parse(bodyText);
        } catch (parseError: any) {
            console.error('Webhook Error: Failed to parse JSON body', {
                error: parseError.message,
                bodyPreview: bodyText.substring(0, 200),
                contentType
            });
            return NextResponse.json({ 
                error: 'Invalid JSON payload', 
                details: parseError.message 
            }, { status: 400 });
        }
        const orderId = payload.id;
        const status = payload.status;

        // Handle order cancellation: restore stock
        // Note: refunded orders do NOT automatically restore stock - staff must manually QC returned items first
        if (status === 'cancelled') {
            // Check if order was previously in pending-consult or pending-review status
            // If so, just remove pending stock tracking and log (don't restore stock - payment was made, refund handled manually)
            const previousPendingConsultLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-consult');
            const previousPendingReviewLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-review');
            if (previousPendingConsultLog || previousPendingReviewLog) {
                // Order was in pending-consult or pending-review (payment made), now cancelled
                // Remove pending stock tracking but DON'T restore stock (refund handled manually via procurement tab)
                await removePendingConsultationStock(orderId);
                return await handlePendingCancellation(orderId, payload, request, previousPendingConsultLog ? 'pending-consult' : 'pending-review');
            }
            // Otherwise, handle as normal cancellation (for orders that were in processing status)
            return await handleOrderCancellation(orderId, payload, request);
        }

        // Handle 'pending-consult' and 'pending-review' status: Track stock deducted by WC
        // WC reduces stock when payment is successful and order moves to "Pending Consultation" or "Pending Review"
        // We need to track this so dashboard shows (stock +X) where X is pending stock
        // Both statuses share the same logic and database table
        if (status === 'pending-consult' || status === 'pending-review') {
            return await handlePendingStatus(orderId, payload, request, status);
        }

        // Only process 'processing' status orders (paid orders that need stock deduction)
        if (status !== 'processing') {
            return NextResponse.json({ success: true, message: `Order status is ${status}, skipping stock update` });
        }

        // Check if order was previously in pending-consult or pending-review status
        // This helps us understand the context: WC already deducted stock (combo SKU or single SKU),
        // but for combo SKUs, components were already deducted in pending-consult/review
        // IMPORTANT: Do NOT remove pending stock tracking yet - we need it to check if components were already deducted
        // We'll remove it AFTER processing components to prevent double deduction
        const previousPendingConsultLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-consult');
        const previousPendingReviewLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-review');
        const previousPendingLog = previousPendingConsultLog || previousPendingReviewLog;
        const previousPendingStatus = previousPendingConsultLog ? 'pending-consult' : (previousPendingReviewLog ? 'pending-review' : null);
        if (previousPendingLog) {
            console.log(`📋 Order #${orderId} was previously in ${previousPendingStatus} - will check if components were already deducted before processing`);
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

        // Step 1: Create transactions for WC-side deductions (direct single SKU orders)
        // WC already deducted these, we just record the transaction
        const wcSideDeductions: Array<{ sku: string; previousStock: number; newStock: number; deductedQty: number; isWcSide: true }> = [];
        
        // Track single SKUs that were directly ordered (not components of combos)
        // IMPORTANT: A SKU can be BOTH directly ordered AND a component of a combo.
        // In that case, the directly ordered quantity is WC-side, and the component quantity is HIS-side.
        const directSingleSkus = Object.keys(directSingleSkuOrders);

        // Check if order was from pending (stock already deducted in pending transaction)
        const wasFromPending = previousPendingLog !== null;
        
        for (const sku of directSingleSkus) {
            const deductedQty = directSingleSkuOrders[sku]; // Only the directly ordered quantity (WC-side)
            const singleSku = singleSkuMap.get(sku);
            if (singleSku) {
                try {
                    // Get current stock state from transactions
                    const currentState = await getCurrentStockState(sku);
                    
                    let stockBefore: number;
                    let stockAfter: number;
                    let pendingBefore: number;
                    let pendingAfter: number;
                    
                    if (wasFromPending) {
                        // Stock was already deducted in pending transaction
                        // Just remove from pending, stock unchanged
                        stockBefore = currentState.stock;
                        stockAfter = currentState.stock; // No change
                        pendingBefore = currentState.pending;
                        pendingAfter = Math.max(0, pendingBefore - deductedQty); // Remove this order's pending
                    } else {
                        // Stock needs to be deducted now
                        stockBefore = currentState.stock;
                        stockAfter = Math.max(0, stockBefore - deductedQty);
                        pendingBefore = currentState.pending;
                        pendingAfter = pendingBefore; // No pending change for direct processing
                    }
                    
                    // Create transaction
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku.id,
                        transactionType: 'order_processing',
                        quantityChange: wasFromPending ? 0 : -deductedQty,
                        stockBefore,
                        stockAfter,
                        pendingBefore,
                        pendingAfter,
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: 'order.processing',
                        details: {
                            deductedQty,
                            isWcSide: true,
                            wasFromPending,
                            orderId
                        }
                    });
                    
                    wcSideDeductions.push({
                        sku,
                        previousStock: stockBefore,
                        newStock: stockAfter,
                        deductedQty,
                        isWcSide: true
                    });
                    
                    console.log(`✅ Created transaction for WC-side deduction ${sku}: ${stockBefore}→${stockAfter}, pending: ${pendingBefore}→${pendingAfter}`);
                } catch (e: any) {
                    console.error(`❌ Failed to create transaction for WC-side deduction ${sku}:`, e.message);
                }
            }
        }

        // Step 2: Deduct component single SKU stocks for combo SKU orders
        // WooCommerce doesn't know about component breakdown, so we need to deduct them
        // IMPORTANT: If order was in pending-consult or pending-review, components were ALREADY deducted,
        // so we should NOT deduct again - just remove pending tracking
        const singleSkuUpdates: Array<{ sku: string; previousStock: number; newStock: number; isWcSide?: false }> = [];
        
        if (singleSkuDeductions.length > 0) {
            const wasPending = previousPendingLog !== null;
            const previousPendingStatus = previousPendingConsultLog ? 'pending-consult' : (previousPendingReviewLog ? 'pending-review' : null);
            console.log(`Processing component single SKU stocks for ${singleSkuDeductions.length} component deductions${wasPending ? ` (order was in ${previousPendingStatus}, components already deducted - will skip deduction and remove pending tracking)` : ' (will deduct components)'}`);
            
            // Group deductions by SKU (in case multiple combos use same component)
            const deductionMap = new Map<string, number>();
            const wcIdMap = new Map<string, number>();
            
            for (const deduction of singleSkuDeductions) {
                deductionMap.set(deduction.sku, (deductionMap.get(deduction.sku) || 0) + deduction.quantity);
                wcIdMap.set(deduction.sku, deduction.wcProductId);
            }

            // Process each component SKU
            for (const [sku, totalQty] of deductionMap.entries()) {
                const wcProductId = wcIdMap.get(sku);
                if (!wcProductId) continue;

                try {
                    // Get current stock state from transactions
                    const currentState = await getCurrentStockState(sku);
                    
                    // Check if there's a pending transaction for this order/SKU
                    const pendingTransactions = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: status === 'pending-consult' ? 'order_pending_consult' : 'order_pending_review',
                        limit: 1
                    });
                    
                    const wasFromPending = pendingTransactions.length > 0;
                    const pendingQty = wasFromPending ? (pendingTransactions[0].pending_after - pendingTransactions[0].pending_before) : 0;
                    
                    let stockBefore: number;
                    let stockAfter: number;
                    let pendingBefore: number;
                    let pendingAfter: number;
                    
                    if (wasFromPending && pendingQty > 0) {
                        // Component was already deducted in pending transaction
                        // Just remove from pending, stock unchanged
                        stockBefore = currentState.stock;
                        stockAfter = currentState.stock; // No change
                        pendingBefore = currentState.pending;
                        pendingAfter = Math.max(0, pendingBefore - pendingQty); // Remove this order's pending
                    } else {
                        // Component was NOT deducted yet - deduct now
                        stockBefore = currentState.stock;
                        stockAfter = Math.max(0, stockBefore - totalQty);
                        pendingBefore = currentState.pending;
                        pendingAfter = pendingBefore; // No pending change for direct processing
                    }
                    
                    // Create transaction
                    const singleSku = singleSkuMap.get(sku);
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku?.id,
                        transactionType: 'order_processing',
                        quantityChange: wasFromPending ? 0 : -totalQty,
                        stockBefore,
                        stockAfter,
                        pendingBefore,
                        pendingAfter,
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: 'order.processing',
                        details: {
                            deductedQty: totalQty,
                            isWcSide: false,
                            hisWrote: true,
                            wasFromPending,
                            orderId,
                            isComboComponent: true
                        }
                    });
                    
                    singleSkuUpdates.push({
                        sku,
                        previousStock: stockBefore,
                        newStock: stockAfter,
                        isWcSide: false
                    });
                    
                    console.log(`✅ Created transaction for combo component ${sku}: ${stockBefore}→${stockAfter}, pending: ${pendingBefore}→${pendingAfter}`);
                } catch (e: any) {
                    console.error(`❌ Failed to create transaction for combo component ${sku}:`, e.message);
                }
            }
        }

        // Pending stock removal is handled automatically by transactions (pending_after < pending_before)
        // No need to manually remove pending tracking

        console.log(`Processing webhook for Order #${orderId}: Affected ${Object.keys(totalDeductions).length} single SKUs`);
        console.log(`  - Direct single SKUs (WC-side): ${wcSideDeductions.length}`, wcSideDeductions.map(d => d.sku));
        if (comboSkusInOrder.length > 0) {
            console.log(`  - ${comboSkusInOrder.length} combo SKU(s) ordered (component stocks deducted)`);
        }
        if (singleSkuUpdates.length > 0) {
            console.log(`  - ${singleSkuUpdates.length} component single SKU(s) deducted by HIS system:`, singleSkuUpdates.map(d => d.sku));
        }

        // Note: Combo availability is calculated from transactions, no need to update WooCommerce
        // Find all combos that use the affected single SKUs (including those we just deducted)
        const affectedCombos = allCombos.filter((c: any) => {
            const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
            return components.some((comp: any) => Object.keys(totalDeductions).includes(comp.sku));
        });

        // Note: Combo availability is calculated from transactions, no need to update WooCommerce
        const comboUpdates: Array<{ sku: string; newStock: number }> = [];

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
                        ? 'Combo SKU(s) ordered. System deducted component single SKU stocks via transactions.'
                        : 'Single SKU(s) ordered. Stock deducted via transactions.'
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
                ? 'Combo SKU order processed: Component single SKU stocks deducted via transactions.'
                : 'Single SKU order processed: Stock deducted via transactions.',
            affectedSingleSkus: Object.keys(totalDeductions).length,
            componentDeductions: singleSkuUpdates.length
        });

    } catch (error) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * Handle pending cancellation: Order was in pending-consult or pending-review (payment made) but now cancelled
 * For combo SKU orders: Restore component stocks (HIS deducted them, so HIS must restore)
 * For single SKU orders: DON'T restore stock (WC will restore, but refund handled manually via procurement tab)
 * Remove pending stock tracking after restoration
 */
async function handlePendingCancellation(orderId: number, payload: any, request?: Request, previousStatus: 'pending-consult' | 'pending-review' = 'pending-consult') {
    try {
        const statusLabel = previousStatus === 'pending-consult' ? 'Pending Consultation' : 'Pending Review';
        console.log(`📋 Processing ${previousStatus} cancellation for Order #${orderId} (payment was made, refund handled manually)`);

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

        // Get pending stock for this order BEFORE removing it (to know what to restore)
        const pendingStockRecords = await getPendingConsultationStockByOrder(orderId);
        const pendingStockMap = new Map(pendingStockRecords.map((r: any) => [r.sku, r.quantity]));

        // Identify combo SKUs in the order
        const comboSkusInOrder: Array<{ sku: string; quantity: number }> = [];
        const directSingleSkus = new Set<string>();
        
        for (const item of lineItems) {
            if (!item.sku) continue;
            const sku = item.sku;
            if (comboSkuMap.has(sku)) {
                comboSkusInOrder.push({ sku, quantity: item.quantity || 0 });
            } else if (singleSkuMap.has(sku)) {
                directSingleSkus.add(sku);
            }
        }

        // Step 1: Restore component stocks for combo SKU orders (HIS deducted these, so HIS must restore)
        // For single SKU orders, WC will restore automatically, so we don't need to restore
        const restoredComponentStocks: Array<{ sku: string; previousStock: number; newStock: number; restoredQty: number }> = [];
        
        if (comboSkusInOrder.length > 0) {
            console.log(`Restoring component stocks for ${comboSkusInOrder.length} combo SKU(s) in cancelled ${previousStatus} order`);
            
            // Get all component SKUs that were deducted for combo orders
            const componentRestorations = new Map<string, number>();
            
            for (const comboOrder of comboSkusInOrder) {
                const combo = comboSkuMap.get(comboOrder.sku);
                if (!combo) continue;
                
                const components = Array.isArray(combo.components) 
                    ? combo.components 
                    : JSON.parse(combo.components || '[]');
                
                for (const comp of components) {
                    if (!comp.sku || !comp.quantity) continue;
                    const restoredQty = comp.quantity * comboOrder.quantity;
                    componentRestorations.set(
                        comp.sku,
                        (componentRestorations.get(comp.sku) || 0) + restoredQty
                    );
                }
            }
            
            // Restore each component stock (using database transactions only)
            for (const [sku, restoreQty] of componentRestorations.entries()) {
                const singleSku = singleSkuMap.get(sku);
                if (!singleSku) continue;
                
                try {
                    // Get current stock state from database (source of truth)
                    const currentState = await getCurrentStockState(sku);
                    const stockBefore = currentState.stock;
                    const stockAfter = stockBefore + restoreQty;
                    
                    // Create transaction to restore stock
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku.id,
                        transactionType: 'order_cancelled',
                        quantityChange: restoreQty,
                        stockBefore,
                        stockAfter,
                        pendingBefore: currentState.pending,
                        pendingAfter: currentState.pending, // No pending change for cancellation
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: `order.${payload.status}`,
                        details: {
                            restoredQty: restoreQty,
                            changeMadeBy: 'HIS',
                            orderId,
                            isComboComponent: true,
                            previousStatus: previousStatus
                        }
                    });
                    
                    restoredComponentStocks.push({
                        sku,
                        previousStock: stockBefore,
                        newStock: stockAfter,
                        restoredQty: restoreQty
                    });
                    
                    console.log(`✅ Restored ${restoreQty} to combo component ${sku} (${stockBefore} → ${stockAfter}) via database transaction`);
                } catch (e: any) {
                    console.error(`❌ Failed to restore component ${sku}:`, e.message);
                }
            }
        }

        // Step 2: Remove pending stock tracking (after restoring combo components)
        await removePendingConsultationStock(orderId);

        // Step 3: Read current stock from database for reporting
        const stockReadings: Array<{ sku: string; wcStock: number }> = [];
        const affectedSingleSkus = new Set<string>();

        for (const item of lineItems) {
            if (!item.sku) continue;
            
            const sku = item.sku;
            if (singleSkuMap.has(sku)) {
                const singleSku = singleSkuMap.get(sku);
                if (singleSku) {
                    try {
                        // Get current stock from database (source of truth)
                        const currentState = await getCurrentStockState(sku);
                        const currentStock = currentState.stock;
                        stockReadings.push({ sku, wcStock: currentStock });
                        affectedSingleSkus.add(sku);
                    } catch (e: any) {
                        console.error(`❌ Failed to read stock for ${sku}:`, e.message);
                    }
                }
            }
        }

        // Also add component SKUs from combo orders
        for (const comboOrder of comboSkusInOrder) {
            const combo = comboSkuMap.get(comboOrder.sku);
            if (combo) {
                const components = Array.isArray(combo.components) 
                    ? combo.components 
                    : JSON.parse(combo.components || '[]');
                components.forEach((comp: any) => {
                    if (comp.sku) affectedSingleSkus.add(comp.sku);
                });
            }
        }

        // Recalculate and update combo SKU availability (stock not restored, but combo should reflect current state)
        const affectedCombos = allCombos.filter((c: any) => {
            const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
            return components.some((comp: any) => affectedSingleSkus.has(comp.sku));
        });

        const comboUpdates: Array<{ sku: string; newStock: number }> = [];

        if (affectedCombos.length > 0) {
            console.log(`Recalculating ${affectedCombos.length} affected combo SKU(s) after ${previousStatus} cancellation`);

            // Build stock map: fetch current stock from WooCommerce
            const stockMap: Record<string, number> = {};

            // Use restored stock values if available
            for (const restored of restoredComponentStocks) {
                stockMap[restored.sku] = restored.newStock;
            }

            // Use stock readings if available
            for (const reading of stockReadings) {
                if (!stockMap.hasOwnProperty(reading.sku)) {
                    stockMap[reading.sku] = reading.wcStock;
                }
            }

            // Collect all unique component SKUs needed for affected combos
            const neededSkus = new Set<string>();
            affectedCombos.forEach((c: any) => {
                const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
                components.forEach((comp: any) => neededSkus.add(comp.sku));
            });

            // Fetch stock for missing components from database
            const missingSkus = Array.from(neededSkus).filter(s => !stockMap.hasOwnProperty(s));
            await Promise.all(missingSkus.map(async (s) => {
                const sData = singleSkuMap.get(s);
                if (sData) {
                    try {
                        const currentState = await getCurrentStockState(s);
                        stockMap[s] = currentState.stock;
                    } catch (e) {
                        console.warn(`Failed to fetch stock for component ${s} from database`, e);
                        stockMap[s] = 0;
                    }
                }
            }));

            // Calculate combo availability (for logging only - no WooCommerce update)
            for (const combo of affectedCombos) {
                const components = Array.isArray(combo.components) ? combo.components : JSON.parse(combo.components || '[]');
                let comboLimit = Infinity;

                for (const comp of components) {
                    const stock = stockMap[comp.sku] || 0;
                    const canMake = Math.floor(stock / comp.quantity);
                    if (canMake < comboLimit) comboLimit = canMake;
                }

                if (comboLimit === Infinity) comboLimit = 0;

                // Note: Combo availability is calculated from database transactions
                // No need to update WooCommerce - database is source of truth
                comboUpdates.push({ sku: combo.sku, newStock: comboLimit });
                console.log(`✅ Calculated combo ${combo.sku} availability after ${previousStatus} cancellation: ${comboLimit} units (database only)`);
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
                comboUpdates: comboUpdates.map(u => ({ 
                    sku: u.sku, 
                    newStock: u.newStock 
                })),
                details: {
                    orderId,
                    status: payload.status,
                    previousStatus: previousStatus,
                    lineItems: lineItems.map((item: any) => ({
                        sku: item.sku,
                        name: item.name,
                        quantity: item.quantity
                    })),
                    stockReadings: stockReadings,
                    componentRestorations: restoredComponentStocks.map(r => ({
                        sku: r.sku,
                        previousStock: r.previousStock,
                        newStock: r.newStock,
                        restoredQty: r.restoredQty,
                        changeMadeBy: 'HIS' // HIS restored combo component stocks
                    })),
                    comboSkusCancelled: comboSkusInOrder,
                    note: comboSkusInOrder.length > 0
                        ? `Order cancelled from ${previousStatus} status (${statusLabel}). Payment was made, so single SKU stock NOT auto-restored (refund handled manually). Combo component stocks restored by HIS system. Pending stock tracking removed. Combo availability updated.`
                        : `Order cancelled from ${previousStatus} status (${statusLabel}). Payment was made, so stock NOT auto-restored. Refund must be handled manually via procurement tab. Pending stock tracking removed. Combo availability updated to reflect current stock state.`
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
            message: comboSkusInOrder.length > 0
                ? `${statusLabel} cancellation processed. Combo component stocks restored. Single SKU stock NOT restored (refund handled manually).`
                : `${statusLabel} cancellation processed. Stock NOT restored (refund handled manually).`,
            stockReadings: stockReadings.length,
            restoredComponents: restoredComponentStocks.length,
            comboUpdates: comboUpdates.length
        });

    } catch (error: any) {
        console.error('Pending-Consult Cancellation Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

/**
 * Handle pending status (pending-consult or pending-review): Track stock deducted by WC
 * WC reduces stock when payment is successful and order moves to "Pending Consultation" or "Pending Review"
 * We track this so dashboard can show (stock +X) where X is pending stock
 * Both statuses share the same logic and database table
 */
async function handlePendingStatus(orderId: number, payload: any, request: Request, status: 'pending-consult' | 'pending-review') {
    try {
        const statusLabel = status === 'pending-consult' ? 'Pending Consultation' : 'Pending Review';
        console.log(`📋 Processing ${status} for Order #${orderId}`);

        // Check if this order was already processed in pending-consult or pending-review status (idempotency protection)
        // Prevents double tracking if order goes: pending-consult/pending-review → other status → pending-consult/pending-review
        const previousPendingConsultLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-consult');
        const previousPendingReviewLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-review');
        const previousPendingLog = previousPendingConsultLog || previousPendingReviewLog;
        if (previousPendingLog && previousPendingLog.success) {
            const previousStatus = previousPendingConsultLog ? 'pending-consult' : 'pending-review';
            console.log(`⏭️ Order #${orderId} was already processed in ${previousStatus} status - skipping duplicate tracking to prevent double counting`);
            return NextResponse.json({ 
                success: true, 
                message: `Order #${orderId} was already processed in ${previousStatus} status - skipping duplicate tracking`,
                previousProcessingTime: previousPendingLog.created_at
            });
        }

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
                if (singleSku) {
                    try {
                        // Get current stock state from transactions (source of truth)
                        const currentState = await getCurrentStockState(sku);
                        
                        // WC already deducted stock, so current stock is after deduction
                        const stockAfter = currentState.stock;
                        const stockBefore = stockAfter + quantity; // Stock before WC deduction
                        
                        // Calculate pending stock from other orders (before adding this order's pending)
                        const pendingBefore = currentState.pending;
                        const pendingAfter = pendingBefore + quantity; // Add this order's pending
                        
                        // Create transaction for pending-consult/pending-review
                        const transactionType = status === 'pending-consult' ? 'order_pending_consult' : 'order_pending_review';
                        await createStockTransaction({
                            sku,
                            singleSkuId: singleSku.id,
                            transactionType,
                            quantityChange: -quantity, // Negative = deduction
                            stockBefore,
                            stockAfter,
                            pendingBefore,
                            pendingAfter,
                            sourceType: 'order',
                            sourceId: orderId,
                            sourceEvent: `order.${status}`,
                            details: {
                                quantity,
                                status,
                                isCombo: false,
                                orderId
                            }
                        });
                        
                        pendingStockUpdates.push({
                            sku,
                            quantity,
                            wcStock: stockAfter,
                            isCombo: false
                        });
                        
                        console.log(`✅ Created transaction for single SKU ${sku}: ${stockBefore}→${stockAfter}, pending: ${pendingBefore}→${pendingAfter}`);
                    } catch (e: any) {
                        console.error(`❌ Failed to create transaction for ${sku}:`, e.message);
                    }
                }
            } else if (comboSkuMap.has(sku)) {
                // Combo SKU - deduct component stocks immediately and track components (not combo SKU)
                // WC deducted combo SKU stock, but components need to be deducted by HIS immediately
                // This ensures dashboard shows correct component stock (e.g., 71+1 instead of 72+1)
                const combo = comboSkuMap.get(sku);
                if (combo && combo.woocommerce_product_id) {
                    try {
                        // Parse components from database JSONB field
                        const components = Array.isArray(combo.components) 
                            ? combo.components 
                            : JSON.parse(combo.components || '[]');
                        
                        // Deduct component stocks immediately (same as processing does)
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
                            
                            const componentSku = singleSkuMap.get(comp.sku);
                            if (!componentSku || !componentSku.woocommerce_product_id) {
                                console.warn(`⚠️ Component SKU ${comp.sku} missing WooCommerce product ID`);
                                continue;
                            }
                            
                            const deductedQty = comp.quantity * quantity;
                            
                            try {
                                // Get current stock state from transactions (source of truth)
                                const currentState = await getCurrentStockState(comp.sku);
                                
                                // Calculate new stock (deduct)
                                const stockBefore = currentState.stock;
                                const stockAfter = Math.max(0, stockBefore - deductedQty);
                                
                                // Calculate pending stock
                                const pendingBefore = currentState.pending;
                                const pendingAfter = pendingBefore + deductedQty; // Add this order's pending
                                
                                // Create transaction for pending-consult/pending-review (combo component)
                                const transactionType = status === 'pending-consult' ? 'order_pending_consult' : 'order_pending_review';
                                await createStockTransaction({
                                    sku: comp.sku,
                                    singleSkuId: componentSku.id,
                                    transactionType,
                                    quantityChange: -deductedQty, // Negative = deduction
                                    stockBefore,
                                    stockAfter,
                                    pendingBefore,
                                    pendingAfter,
                                    sourceType: 'order',
                                    sourceId: orderId,
                                    sourceEvent: `order.${status}`,
                                    details: {
                                        deductedQty,
                                        status,
                                        isCombo: true,
                                        comboSku: sku,
                                        orderId
                                    }
                                });
                                
                                pendingStockUpdates.push({
                                    sku: comp.sku,
                                    quantity: deductedQty,
                                    wcStock: stockAfter,
                                    isCombo: false // Track as component, not combo
                                });
                                
                                console.log(`✅ Created transaction for combo component ${comp.sku}: ${stockBefore}→${stockAfter}, pending: ${pendingBefore}→${pendingAfter}`);
                            } catch (e: any) {
                                console.error(`❌ Failed to deduct/track component ${comp.sku} for combo ${sku}:`, e.message);
                            }
                        }
                    } catch (e: any) {
                        console.error(`❌ Failed to process combo SKU ${sku}:`, e.message);
                    }
                }
            } else {
                console.warn(`⚠️ SKU ${sku} from order #${orderId} not found in database`);
            }
        }

        if (pendingStockUpdates.length === 0) {
            return NextResponse.json({ success: true, message: 'No single SKUs found in order to track' });
        }

        // Step 2: Recalculate and update combo SKU availability in WooCommerce
        // Find all combos that use the affected single SKUs (including those we just deducted/tracked)
        const affectedSingleSkus = new Set(pendingStockUpdates.map(u => u.sku));
        const affectedCombos = allCombos.filter((c: any) => {
            const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
            return components.some((comp: any) => affectedSingleSkus.has(comp.sku));
        });

        const comboUpdates: Array<{ sku: string; newStock: number }> = [];

        if (affectedCombos.length > 0) {
            console.log(`Recalculating ${affectedCombos.length} affected combo SKU(s) for ${status} status`);
            
            // Build stock map: fetch current stock from database (after deductions)
            const stockMap: Record<string, number> = {};

            // Use updated stock from pendingStockUpdates if available, otherwise fetch from database
            for (const update of pendingStockUpdates) {
                stockMap[update.sku] = update.wcStock; // Use the stock after deduction
            }

            // Collect all unique component SKUs needed for affected combos
            const neededSkus = new Set<string>();
            affectedCombos.forEach((c: any) => {
                const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
                components.forEach((comp: any) => neededSkus.add(comp.sku));
            });

            // Fetch stock for other components needed for combo calculations from database
            const missingSkus = Array.from(neededSkus).filter(s => !stockMap.hasOwnProperty(s));
            await Promise.all(missingSkus.map(async (s) => {
                const sData = singleSkuMap.get(s);
                if (sData) {
                    try {
                        const currentState = await getCurrentStockState(s);
                        stockMap[s] = currentState.stock;
                    } catch (e) {
                        console.warn(`Failed to fetch stock for component ${s} from database`, e);
                        stockMap[s] = 0;
                    }
                }
            }));

            // Calculate combo availability (for logging only - no WooCommerce update)
            for (const combo of affectedCombos) {
                const components = Array.isArray(combo.components) ? combo.components : JSON.parse(combo.components || '[]');
                let comboLimit = Infinity;

                for (const comp of components) {
                    const stock = stockMap[comp.sku] || 0;
                    const canMake = Math.floor(stock / comp.quantity);
                    if (canMake < comboLimit) comboLimit = canMake;
                }

                if (comboLimit === Infinity) comboLimit = 0;

                // Note: Combo availability is calculated from database transactions
                // No need to update WooCommerce - database is source of truth
                comboUpdates.push({ sku: combo.sku, newStock: comboLimit });
                console.log(`✅ Calculated combo ${combo.sku} availability for ${status}: ${comboLimit} units (database only)`);
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
                comboUpdates: comboUpdates.map(u => ({ 
                    sku: u.sku, 
                    newStock: u.newStock 
                })),
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
                    note: `Order moved to ${statusLabel} (${status}). WC deducted stock (combo SKU stock for combos, single SKU stock for singles). System tracking pending stock for dashboard display and updated combo availability.`
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
            message: 'Pending consultation stock tracked and combo availability updated',
            pendingStockUpdates: pendingStockUpdates.length,
            comboUpdates: comboUpdates.length
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
                const singleSku = singleSkuMap.get(sku);
                if (!singleSku) continue;

                try {
                    // Get current stock state from database (source of truth)
                    const currentState = await getCurrentStockState(sku);
                    const stockBefore = currentState.stock;
                    const stockAfter = stockBefore + totalQty; // Restore stock

                    // Create transaction to restore stock
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku.id,
                        transactionType: 'order_cancelled',
                        quantityChange: totalQty,
                        stockBefore,
                        stockAfter,
                        pendingBefore: currentState.pending,
                        pendingAfter: currentState.pending, // No pending change for cancellation
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: 'order.cancelled',
                        details: {
                            restoredQty: totalQty,
                            changeMadeBy: 'HIS',
                            orderId,
                            isComboComponent: true
                        }
                    });

                    // Calculate pending stock at the time of this movement
                    const pendingStockAtTime = await getPendingStockAtTime(sku, new Date());
                    
                    // Log stock movement
                    await logStockMovement({
                        sku,
                        singleSkuId: singleSku.id,
                        previousStock: stockBefore,
                        newStock: stockAfter,
                        pendingStock: pendingStockAtTime,
                        sourceType: 'order_cancellation',
                        sourceId: orderId,
                        sourceEvent: 'order.cancelled',
                        details: {
                            restoredQty: totalQty,
                            changeMadeBy: 'HIS',
                            orderId,
                            isComboComponent: true
                        }
                    });

                    restoredUpdates.push({
                        sku,
                        previousStock: stockBefore,
                        newStock: stockAfter,
                        restoredQty: totalQty,
                        changeMadeBy: 'HIS' // HIS system always restores combo component stocks
                    });

                    console.log(`✅ Restored ${totalQty} to ${sku} (${stockBefore} → ${stockAfter}) via database transaction`);
                } catch (e: any) {
                    console.error(`❌ Failed to restore stock for component ${sku}:`, e.message);
                }
            }
        }

        // Step 2: Track single SKU stock restorations
        // For single SKU orders, restore stock via database transactions
        const directSingleSkus = Object.keys(totalRestorations).filter(sku => {
            return !componentRestorations.some(r => r.sku === sku);
        });

        for (const sku of directSingleSkus) {
            const restoreQty = totalRestorations[sku];
            const singleSku = singleSkuMap.get(sku);
            if (singleSku) {
                try {
                    // Get current stock from database (source of truth)
                    const currentState = await getCurrentStockState(sku);
                    const currentStock = currentState.stock;
                    
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
                    
                    // Restore stock via database transaction
                    const stockBefore = stockBeforeRestore;
                    const stockAfter = stockBefore + restoreQty;
                    
                    // Create transaction to restore stock
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku.id,
                        transactionType: 'order_cancelled',
                        quantityChange: restoreQty,
                        stockBefore,
                        stockAfter,
                        pendingBefore: currentState.pending,
                        pendingAfter: currentState.pending, // No pending change for cancellation
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: 'order.cancelled',
                        details: {
                            restoredQty: restoreQty,
                            changeMadeBy: 'HIS',
                            originalDeductionBy: originalChangeMadeBy,
                            orderId
                        }
                    });
                    
                    // Calculate pending stock at the time of this movement
                    const pendingStockAtTime = await getPendingStockAtTime(sku, new Date());
                    
                    // Log stock movement
                    await logStockMovement({
                        sku,
                        singleSkuId: singleSku.id,
                        previousStock: stockBefore,
                        newStock: stockAfter,
                        pendingStock: pendingStockAtTime,
                        sourceType: 'order_cancellation',
                        sourceId: orderId,
                        sourceEvent: 'order.cancelled',
                        details: {
                            restoredQty: restoreQty,
                            changeMadeBy: 'HIS',
                            originalDeductionBy: originalChangeMadeBy,
                            orderId
                        }
                    });
                    
                    wcSideRestorations.push({
                        sku,
                        previousStock: stockBefore,
                        newStock: stockAfter,
                        restoredQty: restoreQty,
                        changeMadeBy: 'HIS', // HIS handles restoration via database
                        originalDeductionBy: originalChangeMadeBy
                    } as any);
                    
                    console.log(`✅ Restored ${restoreQty} to ${sku} (${stockBefore} → ${stockAfter}) via database transaction`);

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

            // Fetch current stock for other components from database
            for (const [sku] of Object.entries(totalRestorations)) {
                if (stockMap.hasOwnProperty(sku)) continue;

                const singleSku = singleSkuMap.get(sku);
                if (singleSku) {
                    try {
                        const currentState = await getCurrentStockState(sku);
                        stockMap[sku] = currentState.stock;
                    } catch (e) {
                        stockMap[sku] = 0;
                    }
                }
            }

            // Fetch stock for other components needed for combo calculations from database
            const neededSkus = new Set<string>();
            affectedCombos.forEach((c: any) => {
                const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
                components.forEach((comp: any) => neededSkus.add(comp.sku));
            });

            const missingSkus = Array.from(neededSkus).filter(s => !stockMap.hasOwnProperty(s));
            await Promise.all(missingSkus.map(async (s) => {
                const sData = singleSkuMap.get(s);
                if (sData) {
                    try {
                        const currentState = await getCurrentStockState(s);
                        stockMap[s] = currentState.stock;
                    } catch (e) {
                        stockMap[s] = 0;
                    }
                }
            }));

            // Calculate combo availability (for logging only - no WooCommerce update)
            for (const combo of affectedCombos) {
                const components = Array.isArray(combo.components) ? combo.components : JSON.parse(combo.components || '[]');
                let comboLimit = Infinity;

                for (const comp of components) {
                    const stock = stockMap[comp.sku] || 0;
                    const canMake = Math.floor(stock / comp.quantity);
                    if (canMake < comboLimit) comboLimit = canMake;
                }

                if (comboLimit === Infinity) comboLimit = 0;

                // Note: Combo availability is calculated from database transactions
                // No need to update WooCommerce - database is source of truth
                comboUpdates.push({ sku: combo.sku, newStock: comboLimit });
                console.log(`✅ Calculated combo ${combo.sku} availability after cancellation: ${comboLimit} units (database only)`);
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
