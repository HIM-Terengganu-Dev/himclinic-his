import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAllComboSkus, getAllSingleSkus, getDummyComboSkus, getDummySingleSkus, logWcWebhook, getWcWebhookLogByOrderId, createStockTransaction, getCurrentStockState, getStockTransactions, removePendingStockByOrder, getPendingStockByOrderFromTransactions, getOrderCurrentStatus } from '@/lib/db/queries';
import { deductComboSKU } from '@/lib/utils/inventory';
import { checkAndSendLowStockAlerts } from '@/lib/utils/lowStockAlerts';
import { syncStockToWooCommerce } from '@/lib/services/woocommerce';

// Disable body parsing to get raw body for signature verification
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Helper function to add dummy SKUs to the maps if in test environment
 */
async function addDummySkusToMaps(singleSkuMap: Map<string, any>, comboSkuMap: Map<string, any>, isTestEnvironment: boolean) {
    if (isTestEnvironment) {
        const { getDummySingleSkus, getDummyComboSkus } = await import('@/lib/db/queries');
        const dummySingleSkus = await getDummySingleSkus();
        const dummyCombos = await getDummyComboSkus();
        dummySingleSkus.forEach((s: any) => {
            if (!singleSkuMap.has(s.sku)) {
                singleSkuMap.set(s.sku, s);
            }
        });
        dummyCombos.forEach((c: any) => {
            if (!comboSkuMap.has(c.sku)) {
                comboSkuMap.set(c.sku, c);
            }
        });
    }
}

/**
 * Filter line items to only include those with valid SKUs that exist in our database
 * Returns: { validLineItems, skippedItems }
 * @param includeDummySkus - If true, also includes dummy SKUs (for test environment)
 */
async function filterValidLineItems(allLineItems: any[], orderId: number, includeDummySkus: boolean = false) {
    if (!allLineItems || !Array.isArray(allLineItems) || allLineItems.length === 0) {
        return { validLineItems: [], skippedItems: [] };
    }

    // Get SKU mappings from database (source of truth)
    const allSingleSkus = await getAllSingleSkus();
    const allCombos = await getAllComboSkus();

    // Create maps for quick lookup (case-insensitive)
    const singleSkuMap = new Map<string, any>();
    const singleSkuMapLower = new Map<string, any>(); // For case-insensitive lookup
    allSingleSkus.forEach((s: any) => {
        const sku = s.sku?.trim() || '';
        if (sku) {
            singleSkuMap.set(sku, s);
            singleSkuMapLower.set(sku.toLowerCase(), s);
        }
    });

    const comboSkuMap = new Map<string, any>();
    const comboSkuMapLower = new Map<string, any>(); // For case-insensitive lookup
    allCombos.forEach((c: any) => {
        const sku = c.sku?.trim() || '';
        if (sku) {
            comboSkuMap.set(sku, c);
            comboSkuMapLower.set(sku.toLowerCase(), c);
        }
    });

    // If including dummy SKUs (for test environment), also add them to the maps
    await addDummySkusToMaps(singleSkuMap, comboSkuMap, includeDummySkus);
    if (includeDummySkus) {
        // Also update lowercase maps for dummy SKUs
        const { getDummySingleSkus, getDummyComboSkus } = await import('@/lib/db/queries');
        const dummySingleSkus = await getDummySingleSkus();
        const dummyCombos = await getDummyComboSkus();
        dummySingleSkus.forEach((s: any) => {
            const sku = s.sku?.trim() || '';
            if (sku && !singleSkuMapLower.has(sku.toLowerCase())) {
                singleSkuMapLower.set(sku.toLowerCase(), s);
            }
        });
        dummyCombos.forEach((c: any) => {
            const sku = c.sku?.trim() || '';
            if (sku && !comboSkuMapLower.has(sku.toLowerCase())) {
                comboSkuMapLower.set(sku.toLowerCase(), c);
            }
        });
    }

    const validLineItems: any[] = [];
    const skippedItems: any[] = [];

    for (const item of allLineItems) {
        if (!item.sku || typeof item.sku !== 'string' || item.sku.trim() === '') {
            console.warn(`⚠️ Order #${orderId} has line item without SKU: ${item.name || 'Unknown'} - SKIPPING`);
            skippedItems.push(item);
            continue;
        }

        const sku = item.sku.trim();
        const skuLower = sku.toLowerCase();

        // Check if SKU exists in our database (single or combo) - case-insensitive
        const foundSingle = singleSkuMap.has(sku) || singleSkuMapLower.has(skuLower);
        const foundCombo = comboSkuMap.has(sku) || comboSkuMapLower.has(skuLower);

        if (!foundSingle && !foundCombo) {
            console.warn(`⚠️ Order #${orderId} has line item with SKU "${sku}" (${item.name || 'Unknown'}) not found in database - SKIPPING`);
            skippedItems.push(item);
            continue;
        }

        // Valid SKU - add to valid line items
        validLineItems.push(item);
    }

    // Log skipped items if any
    if (skippedItems.length > 0) {
        console.log(`ℹ️ Order #${orderId}: Skipped ${skippedItems.length} untracked line item(s):`,
            skippedItems.map((item: any) => `${item.name || 'Unknown'} (SKU: ${item.sku || '(empty)'})`).join(', '));
    }

    return { validLineItems, skippedItems };
}

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

        // Check if this is a test environment request (bypass signature verification)
        const isTestEnvironment = request.headers.get('x-wc-webhook-source') === 'test-environment';

        // Check for signature - if missing, log warning but allow (for testing/debugging)
        // In production, you should enforce signature verification
        if (!signature) {
            if (isTestEnvironment) {
                console.log('🧪 Test environment webhook - skipping signature verification');
            } else {
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
            }
            // Allow to proceed for now - remove this in production if you want strict verification
            // return NextResponse.json({ error: 'Missing signature header' }, { status: 401 });
        } else if (isTestEnvironment) {
            // Test environment request with signature - skip verification
            console.log('🧪 Test environment webhook - skipping signature verification');
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

        // Handle WooCommerce test pings (form-encoded: webhook_id=14)
        if (bodyText.includes('webhook_id=') || bodyText.startsWith('webhook_id=')) {
            console.log('📝 Received WooCommerce test ping/webhook verification - returning success');
            return NextResponse.json({
                success: true,
                message: 'Webhook endpoint is active and receiving requests',
                received: bodyText
            });
        }

        // Parse JSON payload
        let payload;
        try {
            payload = JSON.parse(bodyText);
        } catch (parseError: any) {
            console.error('Webhook Error: Failed to parse JSON body', {
                error: parseError.message,
                bodyPreview: bodyText.substring(0, 200),
                contentType: request.headers.get('content-type')
            });
            return NextResponse.json({
                error: 'Invalid JSON payload',
                details: parseError.message
            }, { status: 400 });
        }

        // Validate payload structure
        if (!payload || typeof payload !== 'object') {
            console.error('Webhook Error: Invalid payload structure', { payload });
            return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
        }
        const orderId = payload.id;
        const status = payload.status;

        // Handle order cancellation: restore stock
        // Note: refunded orders do NOT automatically restore stock - staff must manually QC returned items first
        if (status === 'cancelled') {
            // IMPORTANT: Check current status first to determine what stage the order is in
            // If order went: pending → processing → nv-pending-pickup → cancelled,
            // we should NOT try to remove from pending (it's already past that stage)
            const currentStatus = await getOrderCurrentStatus(orderId);

            // If current status is still pending-consult or pending-review, handle as pending cancellation
            if (currentStatus === 'pending-consult' || currentStatus === 'pending-review') {
                // Order is still in pending status, now cancelled
                // Remove pending stock tracking but DON'T restore stock (refund handled manually via procurement tab)
                await removePendingStockByOrder(orderId);
                return await handlePendingCancellation(orderId, payload, request, currentStatus === 'pending-consult' ? 'pending-consult' : 'pending-review', isTestEnvironment);
            }

            // Otherwise, handle as normal cancellation (for orders that were in processing or nv-pending-pickup)
            // This will check if order was in nv-pending-pickup and restore in_warehouse accordingly
            return await handleOrderCancellation(orderId, payload, request, isTestEnvironment);
        }

        // Handle 'pending-consult' and 'pending-review' status: Track stock deducted by WC
        // WC reduces stock when payment is successful and order moves to "Pending Consultation" or "Pending Review"
        // We need to track this so dashboard shows (stock +X) where X is pending stock
        // Both statuses share the same logic and database table
        if (status === 'pending-consult' || status === 'pending-review') {
            return await handlePendingStatus(orderId, payload, request, status, isTestEnvironment);
        }

        // Handle 'nv-pending-pickup' status: Final stage that deducts from in_warehouse
        // This is the ONLY webhook that deducts from in_warehouse
        if (status === 'nv-pending-pickup') {
            return await handleNvPendingPickup(orderId, payload, request, isTestEnvironment);
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

        // ── GUARD 1: nv-pending-pickup idempotency ──────────────────────────────
        // If this order already advanced to nv-pending-pickup, any subsequent
        // order.processing webhooks are WooCommerce retries/replays and must be
        // dropped unconditionally. Processing them would inflate the processing
        // counter even though the order has already been physically dispatched.
        const previousNvPickupLog = await getWcWebhookLogByOrderId(orderId, 'order.nv-pending-pickup');
        if (previousNvPickupLog && previousNvPickupLog.success) {
            console.log(`⏭️ Order #${orderId} already reached nv-pending-pickup (dispatched) - ignoring late order.processing webhook replay from WooCommerce`);
            return NextResponse.json({
                success: true,
                message: `Order #${orderId} already dispatched (nv-pending-pickup). Ignoring replayed order.processing webhook.`,
                previousPickupTime: previousNvPickupLog.created_at
            });
        }

        // ── GUARD 2: processing idempotency ────────────────────────────────────
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
                // Order was already processed and not cancelled
                // BUT: Check if there's a pending transaction - if so, processing is valid (moving from pending to processing)
                const pendingConsultLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-consult');
                const pendingReviewLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-review');
                const hasPendingLog = pendingConsultLog || pendingReviewLog;

                if (hasPendingLog) {
                    // Order has a pending log — but only allow reprocessing if pending stock is STILL > 0.
                    // If pending stock already moved to processing (e.g. a previous processing webhook did it),
                    // this is a true duplicate and must be skipped to prevent inflating processing counts.
                    // Note: allLineItems is declared later, so we extract the first SKU from the pending log's details.
                    const pendingAffectedSkus: string[] = (hasPendingLog as any)?.affected_skus ?? [];
                    const firstSku: string | undefined = Array.isArray(pendingAffectedSkus) && pendingAffectedSkus.length > 0
                        ? pendingAffectedSkus[0]
                        : undefined;
                    let hasPendingStockRemaining = false;
                    if (firstSku) {
                        const liveState = await getCurrentStockState(firstSku);
                        hasPendingStockRemaining = ((liveState?.pendingConsult ?? 0) > 0) || ((liveState?.pendingReview ?? 0) > 0);
                    }
                    if (hasPendingStockRemaining) {
                        // Real pending stock exists — moving from pending to processing is valid
                        console.log(`✅ Order #${orderId} has pending stock remaining - allowing processing (moving from pending to processing)`);
                    } else {
                        // Pending log exists but no actual pending stock left → true duplicate, skip
                        console.log(`⏭️ Order #${orderId} pending log exists but no pending stock remaining - skipping duplicate processing to prevent double deduction`);
                        return NextResponse.json({
                            success: true,
                            message: `Order #${orderId} was already processed - skipping duplicate processing to prevent double stock deduction`,
                            previousProcessingTime: previousProcessingLog.created_at
                        });
                    }
                } else {
                    // Order was already processed, not cancelled, and no pending - skip to prevent double deduction
                    console.log(`⏭️ Order #${orderId} was already processed successfully - skipping duplicate processing to prevent double deduction`);
                    return NextResponse.json({
                        success: true,
                        message: `Order #${orderId} was already processed - skipping duplicate processing to prevent double stock deduction`,
                        previousProcessingTime: previousProcessingLog.created_at
                    });
                }
            }
        }

        // Get all line items from webhook payload
        // WooCommerce webhook includes line_items in the payload
        const allLineItems = payload.line_items;
        if (!allLineItems || !Array.isArray(allLineItems) || allLineItems.length === 0) {
            return NextResponse.json({ success: true, message: 'No line items in order' });
        }

        // Filter line items to only include those with valid SKUs that exist in our database
        // Include dummy SKUs if this is a test environment request
        const { validLineItems, skippedItems } = await filterValidLineItems(allLineItems, orderId, isTestEnvironment);

        // If no valid line items, don't process or log the order
        if (validLineItems.length === 0) {
            console.warn(`⚠️ Order #${orderId} has no valid line items (all SKUs are untracked or missing) - SKIPPING ORDER`);
            return NextResponse.json({
                success: true,
                message: 'Order skipped - no valid tracked SKUs',
                skippedItems: skippedItems.map((item: any) => ({
                    name: item.name,
                    sku: item.sku || '(empty)',
                    quantity: item.quantity
                }))
            });
        }

        // Use only valid line items for processing
        const lineItems = validLineItems;

        // Get SKU mappings from database (source of truth)
        const allSingleSkus = await getAllSingleSkus();
        const allCombos = await getAllComboSkus();

        // Create maps for quick lookup
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));
        const comboSkuMap = new Map(allCombos.map((c: any) => [c.sku, c]));

        // If test environment, also include dummy SKUs
        await addDummySkusToMaps(singleSkuMap, comboSkuMap, isTestEnvironment);

        // Track what needs to be deducted
        // IMPORTANT: System no longer reads from WooCommerce - HIS system deducts ALL stock (both single SKU and combo components)
        const totalDeductions: Record<string, number> = {};
        const directSingleSkuOrders: Record<string, number> = {}; // Track SKUs directly ordered (HIS will deduct)
        const singleSkuDeductions: Array<{ sku: string; quantity: number; wcProductId: number }> = [];
        const comboSkusInOrder: Array<{ sku: string; quantity: number }> = [];

        for (const item of lineItems) {
            const sku = item.sku.trim();
            const quantity = item.quantity || 0;

            // Validate against database: Check if it's a single SKU
            if (singleSkuMap.has(sku)) {
                // Direct single SKU order: HIS system will deduct stock (no longer relying on WC)
                totalDeductions[sku] = (totalDeductions[sku] || 0) + quantity;
                directSingleSkuOrders[sku] = (directSingleSkuOrders[sku] || 0) + quantity;

                // Add to singleSkuDeductions so it gets deducted by HIS system
                const singleSku = singleSkuMap.get(sku);
                if (singleSku && singleSku.woocommerce_product_id) {
                    singleSkuDeductions.push({
                        sku,
                        quantity,
                        wcProductId: singleSku.woocommerce_product_id
                    });
                }
                console.log(`✅ Found single SKU ${sku} in database, quantity: ${quantity} (HIS will deduct)`);
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

        // Step 1 & 2: Deduct ALL single SKU stocks (both direct orders and combo components)
        // IMPORTANT: System no longer reads from WooCommerce - HIS system deducts everything
        // Process all single SKU deductions together (direct orders + combo components)
        const singleSkuUpdates: Array<{ sku: string; previousStock: number; newStock: number; deductedQty: number; isWcSide: false; isComboComponent: boolean }> = [];

        if (singleSkuDeductions.length > 0) {
            const wasPending = previousPendingLog !== null;
            const previousPendingStatus = previousPendingConsultLog ? 'pending-consult' : (previousPendingReviewLog ? 'pending-review' : null);
            console.log(`Processing ${singleSkuDeductions.length} single SKU deductions (direct orders + combo components)${wasPending ? ` (order was in ${previousPendingStatus}, stock already deducted - will skip deduction and remove pending tracking)` : ' (will deduct stock)'}`);

            // Group deductions by SKU (in case a SKU is both directly ordered AND a combo component)
            const deductionMap = new Map<string, number>();
            const wcIdMap = new Map<string, number>();
            const isComboComponentMap = new Map<string, boolean>(); // Track if SKU is a combo component

            for (const deduction of singleSkuDeductions) {
                deductionMap.set(deduction.sku, (deductionMap.get(deduction.sku) || 0) + deduction.quantity);
                wcIdMap.set(deduction.sku, deduction.wcProductId);
                // Check if this SKU is a direct order (not just a combo component)
                const isDirectOrder = directSingleSkuOrders.hasOwnProperty(deduction.sku);
                // If already marked as combo component, keep it; otherwise mark based on whether it's a direct order
                if (!isComboComponentMap.has(deduction.sku)) {
                    isComboComponentMap.set(deduction.sku, !isDirectOrder);
                }
            }

            // Process each SKU (both direct orders and combo components)
            for (const [sku, totalQty] of deductionMap.entries()) {
                const wcProductId = wcIdMap.get(sku);
                if (!wcProductId) continue;

                const isComboComponent = isComboComponentMap.get(sku) || false;

                try {
                    // Get current stock state from transactions
                    const currentState = await getCurrentStockState(sku);

                    // NEW BEHAVIOR: Do NOT deduct from in_warehouse, only move from pending to processing or add to processing
                    const inWarehouseBefore = currentState.inWarehouse;
                    const inWarehouseAfter = inWarehouseBefore; // No change to in_warehouse

                    // Check if there's a pending transaction for this order/SKU
                    const pendingConsultTransactions = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_pending_consult',
                        limit: 1
                    });
                    const pendingReviewTransactions = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_pending_review',
                        limit: 1
                    });

                    const wasFromPendingConsult = pendingConsultTransactions.length > 0;
                    const wasFromPendingReview = pendingReviewTransactions.length > 0;
                    const wasFromPending = wasFromPendingConsult || wasFromPendingReview;

                    let pendingConsultQty = 0;
                    let pendingReviewQty = 0;
                    if (wasFromPendingConsult) {
                        pendingConsultQty = pendingConsultTransactions[0].pending_consult_after - pendingConsultTransactions[0].pending_consult_before;
                    }
                    if (wasFromPendingReview) {
                        pendingReviewQty = pendingReviewTransactions[0].pending_review_after - pendingReviewTransactions[0].pending_review_before;
                    }
                    const totalPendingQty = pendingConsultQty + pendingReviewQty;

                    // Get current status counts
                    const pendingConsultBefore = currentState.pendingConsult;
                    const pendingReviewBefore = currentState.pendingReview;
                    const processingBefore = currentState.processing;

                    let pendingConsultAfter = pendingConsultBefore;
                    let pendingReviewAfter = pendingReviewBefore;
                    let processingAfter = processingBefore;

                    if (wasFromPending && totalPendingQty > 0) {
                        // Move from pending to processing
                        if (wasFromPendingConsult) {
                            pendingConsultAfter = Math.max(0, pendingConsultBefore - pendingConsultQty);
                        }
                        if (wasFromPendingReview) {
                            pendingReviewAfter = Math.max(0, pendingReviewBefore - pendingReviewQty);
                        }
                        processingAfter = processingBefore + totalPendingQty; // Add to processing
                    } else {
                        // Order goes directly to processing (no prior pending)
                        processingAfter = processingBefore + totalQty; // Add directly to processing
                    }

                    // Calculate available_for_purchase
                    const availableAfter = Math.max(0, inWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingAfter);

                    // Backorder is now calculated: max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
                    // No need to manually track it - it's derived from current state
                    const backorderBefore = Math.max(0, (pendingConsultBefore + pendingReviewBefore + processingBefore) - inWarehouseBefore);
                    const backorderAfter = Math.max(0, (pendingConsultAfter + pendingReviewAfter + processingAfter) - inWarehouseAfter);

                    // Create transaction
                    const singleSku = singleSkuMap.get(sku);
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku?.id,
                        transactionType: 'order_processing',
                        quantityChange: 0, // No change to in_warehouse
                        // Legacy fields (for backward compatibility)
                        stockBefore: inWarehouseBefore,
                        stockAfter: inWarehouseAfter,
                        pendingBefore: pendingConsultBefore + pendingReviewBefore,
                        pendingAfter: pendingConsultAfter + pendingReviewAfter,
                        // New fields
                        inWarehouseBefore,
                        inWarehouseAfter,
                        processingBefore,
                        processingAfter,
                        pendingConsultBefore,
                        pendingConsultAfter,
                        pendingReviewBefore,
                        pendingReviewAfter,
                        backorderBefore,
                        backorderAfter,
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: 'order.processing',
                        details: {
                            quantity: totalQty,
                            wasFromPending,
                            wasFromPendingConsult,
                            wasFromPendingReview,
                            orderId,
                            isComboComponent,
                            availableForPurchase: availableAfter
                        }
                    });

                    // Sync stock to WooCommerce (async, don't block response)
                    if (singleSku) {
                        syncStockToWooCommerce(sku).catch(err => {
                            console.error(`Error syncing ${sku} to WooCommerce:`, err);
                        });
                    }

                    singleSkuUpdates.push({
                        sku,
                        previousStock: inWarehouseBefore,
                        newStock: inWarehouseAfter,
                        deductedQty: totalQty,
                        isWcSide: false,
                        isComboComponent
                    });

                    const skuType = isComboComponent ? 'combo component' : 'direct order';
                    const statusChange = wasFromPending
                        ? `moved from pending (${pendingConsultBefore + pendingReviewBefore}) to processing (${processingAfter})`
                        : `added to processing (${processingAfter})`;
                    console.log(`✅ Created transaction for ${skuType} ${sku}: in_warehouse=${inWarehouseAfter} (no change), ${statusChange}, available=${availableAfter}`);
                } catch (e: any) {
                    console.error(`❌ Failed to create transaction for ${sku}:`, e.message);
                }
            }
        }

        // Pending stock removal is handled automatically by transactions (pending_after < pending_before)
        // No need to manually remove pending tracking

        console.log(`Processing webhook for Order #${orderId}: Affected ${Object.keys(totalDeductions).length} single SKUs`);
        const directOrders = singleSkuUpdates.filter(u => !u.isComboComponent);
        const comboComponents = singleSkuUpdates.filter(u => u.isComboComponent);
        if (directOrders.length > 0) {
            console.log(`  - ${directOrders.length} direct single SKU(s) deducted by HIS system:`, directOrders.map(d => d.sku));
        }
        if (comboSkusInOrder.length > 0) {
            console.log(`  - ${comboSkusInOrder.length} combo SKU(s) ordered`);
        }
        if (comboComponents.length > 0) {
            console.log(`  - ${comboComponents.length} combo component single SKU(s) deducted by HIS system:`, comboComponents.map(d => d.sku));
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

        // Extract SKUs from valid line items for logging (only tracked SKUs)
        const orderSkus = lineItems.map((item: any) => item.sku.trim()).filter(Boolean);

        // Get the first SKU for display purposes (if available)
        const firstSku = orderSkus.length > 0 ? orderSkus[0] : undefined;

        // Calculate total quantity for display (sum of valid line items only)
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
                currentStatus: 'processing', // Track current status
                affectedSkus: orderSkus,
                comboUpdates: comboUpdates.map(u => ({
                    sku: u.sku,
                    newStock: u.newStock
                })),
                details: {
                    orderId,
                    status,
                    lineItems: lineItems.map((item: any) => ({
                        sku: item.sku.trim(),
                        name: item.name,
                        quantity: item.quantity
                    })),
                    skippedLineItems: skippedItems.length > 0 ? skippedItems.map((item: any) => ({
                        sku: item.sku || '(empty)',
                        name: item.name,
                        quantity: item.quantity,
                        reason: !item.sku || item.sku.trim() === '' ? 'No SKU' : 'SKU not tracked'
                    })) : undefined,
                    comboSkusOrdered: comboSkusInOrder,
                    componentDeductions: singleSkuUpdates.map(u => ({
                        sku: u.sku,
                        previousStock: u.previousStock,
                        newStock: u.newStock,
                        deductedQty: u.deductedQty,
                        isWcSide: false, // HIS system deducts everything (no longer reads from WC)
                        hisWrote: true, // HIS wrote
                        isComboComponent: u.isComboComponent
                    })),
                    affectedSingleSkus: Object.keys(totalDeductions),
                    note: comboSkusInOrder.length > 0
                        ? 'Combo SKU(s) ordered. Order moved to processing (no in_warehouse deduction). Component stocks tracked in processing status.'
                        : 'Single SKU(s) ordered. Order moved to processing (no in_warehouse deduction). Stock tracked in processing status.'
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
                componentDeductions: singleSkuUpdates
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

        // Check for low stock alerts (async, don't block response)
        const affectedSkus = Object.keys(totalDeductions);
        checkAndSendLowStockAlerts(affectedSkus).catch(err => {
            console.error('Error checking low stock alerts:', err);
        });

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
async function handlePendingCancellation(orderId: number, payload: any, request?: Request, previousStatus: 'pending-consult' | 'pending-review' = 'pending-consult', isTestEnvironment: boolean = false) {
    try {
        const statusLabel = previousStatus === 'pending-consult' ? 'Pending Consultation' : 'Pending Review';
        console.log(`📋 Processing ${previousStatus} cancellation for Order #${orderId} (payment was made, refund handled manually)`);

        // Get line items from webhook payload
        const allLineItems = payload.line_items;
        if (!allLineItems || !Array.isArray(allLineItems) || allLineItems.length === 0) {
            return NextResponse.json({ success: true, message: 'No line items in order' });
        }

        // Filter line items to only include those with valid SKUs
        const { validLineItems, skippedItems } = await filterValidLineItems(allLineItems, orderId, isTestEnvironment);

        // If no valid line items, don't process or log
        if (validLineItems.length === 0) {
            console.warn(`⚠️ Order #${orderId} has no valid line items (all SKUs are untracked or missing) - SKIPPING ORDER`);
            return NextResponse.json({
                success: true,
                message: 'Order skipped - no valid tracked SKUs',
                skippedItems: skippedItems.map((item: any) => ({
                    name: item.name,
                    sku: item.sku || '(empty)',
                    quantity: item.quantity
                }))
            });
        }

        const lineItems = validLineItems;

        // Get SKU mappings from database
        const allSingleSkus = await getAllSingleSkus();
        const allCombos = await getAllComboSkus();
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));
        const comboSkuMap = new Map(allCombos.map((c: any) => [c.sku, c]));

        // If test environment, also include dummy SKUs
        await addDummySkusToMaps(singleSkuMap, comboSkuMap, isTestEnvironment);

        // Get pending stock for this order from stock_transactions (replaces legacy pending_consultation_stock table)
        // Note: This is currently unused but kept for potential future use
        const pendingStockRecords = await getPendingStockByOrderFromTransactions(orderId);
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

        // Step 1: Remove from pending (both single SKU and combo components)
        // NEW BEHAVIOR: Do NOT restore to in_warehouse (pending doesn't deduct from in_warehouse)
        // When pending → cancelled: Remove from pending only, no in_warehouse restoration
        const restoredComponentStocks: Array<{ sku: string; previousStock: number; newStock: number; restoredQty: number }> = [];
        const restoredSingleSkus: Array<{ sku: string; previousStock: number; newStock: number; restoredQty: number }> = [];

        // Step 1a: Remove single SKU from pending (direct orders)
        if (directSingleSkus.size > 0) {
            console.log(`Removing ${directSingleSkus.size} direct single SKU(s) from ${previousStatus} in cancelled order`);

            for (const sku of directSingleSkus) {
                const singleSku = singleSkuMap.get(sku);
                if (!singleSku) continue;

                // Get pending quantity for this order/SKU
                const pendingTransactions = await getStockTransactions({
                    sku,
                    sourceId: orderId,
                    transactionType: previousStatus === 'pending-consult' ? 'order_pending_consult' : 'order_pending_review',
                    limit: 1
                });

                if (pendingTransactions.length === 0) continue;

                const pendingQty = previousStatus === 'pending-consult'
                    ? (pendingTransactions[0].pending_consult_after - pendingTransactions[0].pending_consult_before)
                    : (pendingTransactions[0].pending_review_after - pendingTransactions[0].pending_review_before);
                if (pendingQty <= 0) continue;

                try {
                    // Get current stock state from database (source of truth)
                    const currentState = await getCurrentStockState(sku);

                    // NEW BEHAVIOR: Do NOT restore to in_warehouse
                    const inWarehouseBefore = currentState.inWarehouse;
                    const inWarehouseAfter = inWarehouseBefore; // No change

                    // Remove from pending_consult or pending_review
                    const pendingConsultBefore = currentState.pendingConsult;
                    const pendingReviewBefore = currentState.pendingReview;
                    const processingBefore = currentState.processing;

                    let pendingConsultAfter = pendingConsultBefore;
                    let pendingReviewAfter = pendingReviewBefore;
                    const processingAfter = processingBefore; // No change to processing when cancelling from pending

                    if (previousStatus === 'pending-consult') {
                        pendingConsultAfter = Math.max(0, pendingConsultBefore - pendingQty);
                    } else {
                        pendingReviewAfter = Math.max(0, pendingReviewBefore - pendingQty);
                    }

                    // Calculate available_for_purchase
                    const availableAfter = Math.max(0, inWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingAfter);

                    // Backorder is now calculated: max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
                    // No need to manually track it - it's derived from current state
                    const backorderBefore = Math.max(0, (pendingConsultBefore + pendingReviewBefore + processingBefore) - inWarehouseBefore);
                    const backorderAfter = Math.max(0, (pendingConsultAfter + pendingReviewAfter + processingAfter) - inWarehouseAfter);

                    // Create transaction to remove from pending
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku.id,
                        transactionType: 'order_cancelled',
                        quantityChange: 0, // No change to in_warehouse
                        // Legacy fields
                        stockBefore: inWarehouseBefore,
                        stockAfter: inWarehouseAfter,
                        pendingBefore: pendingConsultBefore + pendingReviewBefore,
                        pendingAfter: pendingConsultAfter + pendingReviewAfter,
                        // New fields
                        inWarehouseBefore,
                        inWarehouseAfter,
                        processingBefore,
                        processingAfter: processingBefore, // No change
                        pendingConsultBefore,
                        pendingConsultAfter,
                        pendingReviewBefore,
                        pendingReviewAfter,
                        backorderBefore,
                        backorderAfter,
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: `order.${payload.status}`,
                        details: {
                            removedFromPending: pendingQty,
                            changeMadeBy: 'HIS',
                            orderId,
                            isComboComponent: false,
                            previousStatus: previousStatus,
                            availableForPurchase: availableAfter
                        }
                    });

                    // Sync stock to WooCommerce (async, don't block response)
                    syncStockToWooCommerce(sku).catch(err => {
                        console.error(`Error syncing ${sku} to WooCommerce:`, err);
                    });

                    restoredSingleSkus.push({
                        sku,
                        previousStock: inWarehouseBefore,
                        newStock: inWarehouseAfter,
                        restoredQty: 0 // No restoration, just removal from pending
                    });

                    console.log(`✅ Removed ${pendingQty} from ${previousStatus} for single SKU ${sku}: in_warehouse=${inWarehouseAfter} (no change), available=${availableAfter}`);
                } catch (e: any) {
                    console.error(`❌ Failed to remove single SKU ${sku} from pending:`, e.message);
                }
            }
        }

        // Step 1b: Remove combo component stocks from pending
        if (comboSkusInOrder.length > 0) {
            console.log(`Removing component stocks from ${previousStatus} for ${comboSkusInOrder.length} combo SKU(s) in cancelled order`);

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

                    // NEW BEHAVIOR: Do NOT restore to in_warehouse
                    const inWarehouseBefore = currentState.inWarehouse;
                    const inWarehouseAfter = inWarehouseBefore; // No change

                    // Remove from pending_consult or pending_review
                    const pendingConsultBefore = currentState.pendingConsult;
                    const pendingReviewBefore = currentState.pendingReview;
                    const processingBefore = currentState.processing;

                    let pendingConsultAfter = pendingConsultBefore;
                    let pendingReviewAfter = pendingReviewBefore;
                    const processingAfter = processingBefore; // No change to processing when cancelling from pending

                    // Get pending quantity for this order/SKU
                    const pendingTransactions = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: previousStatus === 'pending-consult' ? 'order_pending_consult' : 'order_pending_review',
                        limit: 1
                    });

                    if (pendingTransactions.length > 0) {
                        const pendingQty = previousStatus === 'pending-consult'
                            ? (pendingTransactions[0].pending_consult_after - pendingTransactions[0].pending_consult_before)
                            : (pendingTransactions[0].pending_review_after - pendingTransactions[0].pending_review_before);

                        if (previousStatus === 'pending-consult') {
                            pendingConsultAfter = Math.max(0, pendingConsultBefore - pendingQty);
                        } else {
                            pendingReviewAfter = Math.max(0, pendingReviewBefore - pendingQty);
                        }
                    }

                    // Calculate available_for_purchase
                    const availableAfter = Math.max(0, inWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingAfter);

                    // Backorder is now calculated: max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
                    // No need to manually track it - it's derived from current state
                    const backorderBefore = Math.max(0, (pendingConsultBefore + pendingReviewBefore + processingBefore) - inWarehouseBefore);
                    const backorderAfter = Math.max(0, (pendingConsultAfter + pendingReviewAfter + processingAfter) - inWarehouseAfter);

                    // Create transaction to remove from pending
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku.id,
                        transactionType: 'order_cancelled',
                        quantityChange: 0, // No change to in_warehouse
                        // Legacy fields
                        stockBefore: inWarehouseBefore,
                        stockAfter: inWarehouseAfter,
                        pendingBefore: pendingConsultBefore + pendingReviewBefore,
                        pendingAfter: pendingConsultAfter + pendingReviewAfter,
                        // New fields
                        inWarehouseBefore,
                        inWarehouseAfter,
                        processingBefore,
                        processingAfter: processingBefore, // No change
                        pendingConsultBefore,
                        pendingConsultAfter,
                        pendingReviewBefore,
                        pendingReviewAfter,
                        backorderBefore,
                        backorderAfter,
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: `order.${payload.status}`,
                        details: {
                            removedFromPending: restoreQty,
                            changeMadeBy: 'HIS',
                            orderId,
                            isComboComponent: true,
                            previousStatus: previousStatus,
                            availableForPurchase: availableAfter
                        }
                    });

                    // Sync stock to WooCommerce (async, don't block response)
                    syncStockToWooCommerce(sku).catch(err => {
                        console.error(`Error syncing ${sku} to WooCommerce:`, err);
                    });

                    restoredComponentStocks.push({
                        sku,
                        previousStock: inWarehouseBefore,
                        newStock: inWarehouseAfter,
                        restoredQty: 0 // No restoration, just removal from pending
                    });

                    console.log(`✅ Removed ${restoreQty} from ${previousStatus} for combo component ${sku}: in_warehouse=${inWarehouseAfter} (no change), available=${availableAfter}`);
                } catch (e: any) {
                    console.error(`❌ Failed to remove component ${sku} from pending:`, e.message);
                }
            }
        }

        // Step 2: Pending stock removal is handled directly in Step 1 via transactions
        // No need to call removePendingStockByOrder - we handle it in the transactions above

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
                        stockMap[s] = currentState.inWarehouse; // Use in_warehouse for combo calculations
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
                currentStatus: 'cancelled', // Track current status
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
                    componentRestorations: [
                        ...restoredSingleSkus.map(r => ({
                            sku: r.sku,
                            previousStock: r.previousStock,
                            newStock: r.newStock,
                            restoredQty: r.restoredQty,
                            changeMadeBy: 'HIS' // HIS restored single SKU stocks
                        })),
                        ...restoredComponentStocks.map(r => ({
                            sku: r.sku,
                            previousStock: r.previousStock,
                            newStock: r.newStock,
                            restoredQty: r.restoredQty,
                            changeMadeBy: 'HIS' // HIS restored combo component stocks
                        }))
                    ],
                    comboSkusCancelled: comboSkusInOrder,
                    note: `Order cancelled from ${previousStatus} status (${statusLabel}). Removed from pending (no in_warehouse restoration). Combo availability updated.`
                },
                ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
                userAgent,
                success: true
            });
        } catch (logError: any) {
            console.error(`❌ Failed to log webhook for Order #${orderId}:`, logError.message);
        }

        // Check for low stock alerts (async, don't block response)
        const affectedSkus = [
            ...restoredSingleSkus.map((s: any) => s.sku),
            ...restoredComponentStocks.map((s: any) => s.sku)
        ];
        const uniqueAffectedSkus = Array.from(new Set(affectedSkus));
        checkAndSendLowStockAlerts(uniqueAffectedSkus).catch(err => {
            console.error('Error checking low stock alerts:', err);
        });

        return NextResponse.json({
            success: true,
            message: `${statusLabel} cancellation processed. Removed from pending (no in_warehouse restoration).`,
            stockReadings: stockReadings.length,
            restoredSingleSkus: restoredSingleSkus.length,
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
async function handlePendingStatus(orderId: number, payload: any, request: Request, status: 'pending-consult' | 'pending-review', isTestEnvironment: boolean = false) {
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

        // IMPORTANT: Check if there's a processing transaction for this order (misfire)
        // If pending-consult/pending-review comes after processing, the processing was a misfire
        // We need to delete the processing transaction and reverse its effects
        const processingTransactions = await getStockTransactions({
            sourceId: orderId,
            transactionType: 'order_processing',
            limit: 100 // Get all processing transactions for this order
        });

        if (processingTransactions.length > 0) {
            console.warn(`⚠️ MISFIRE DETECTED: Order #${orderId} has processing transaction(s) but is now in ${status}. Deleting misfired processing transaction(s)...`);

            // Delete all processing transactions for this order and reverse their effects
            const { query } = await import('@/lib/db/connection');
            for (const tx of processingTransactions) {
                try {
                    // Get the transaction details to reverse its effects
                    const sku = tx.sku;
                    const processingQty = (tx.processing_after || 0) - (tx.processing_before || 0);

                    if (processingQty > 0) {
                        // Reverse the processing count by creating a correction transaction
                        // Get current state
                        const currentState = await getCurrentStockState(sku);

                        // Calculate what the state should be (remove the processing that was incorrectly added)
                        const processingBefore = currentState.processing;
                        const processingAfter = Math.max(0, processingBefore - processingQty);

                        // Create a correction transaction to reverse the misfired processing
                        await createStockTransaction({
                            sku,
                            singleSkuId: tx.single_sku_id || undefined,
                            transactionType: 'order_processing',
                            quantityChange: 0,
                            stockBefore: currentState.inWarehouse,
                            stockAfter: currentState.inWarehouse,
                            pendingBefore: currentState.pendingConsult + currentState.pendingReview,
                            pendingAfter: currentState.pendingConsult + currentState.pendingReview,
                            inWarehouseBefore: currentState.inWarehouse,
                            inWarehouseAfter: currentState.inWarehouse,
                            processingBefore,
                            processingAfter,
                            pendingConsultBefore: currentState.pendingConsult,
                            pendingConsultAfter: currentState.pendingConsult,
                            pendingReviewBefore: currentState.pendingReview,
                            pendingReviewAfter: currentState.pendingReview,
                            backorderBefore: Math.max(0, (currentState.pendingConsult + currentState.pendingReview + processingBefore) - currentState.inWarehouse),
                            backorderAfter: Math.max(0, (currentState.pendingConsult + currentState.pendingReview + processingAfter) - currentState.inWarehouse),
                            sourceType: 'order',
                            sourceId: orderId,
                            sourceEvent: 'order.processing',
                            details: {
                                correction: true,
                                reason: `Misfired processing transaction deleted - order went to ${status} instead`,
                                originalTransactionId: tx.id,
                                reversedQuantity: processingQty
                            }
                        });

                        // Sync stock to WooCommerce (async, don't block response)
                        syncStockToWooCommerce(sku).catch(err => {
                            console.error(`Error syncing ${sku} to WooCommerce:`, err);
                        });

                        console.log(`✅ Created correction transaction for ${sku} to reverse ${processingQty} from processing (misfire correction)`);
                    }

                    // Delete the misfired processing transaction
                    await query(
                        `DELETE FROM "his_db".stock_transactions WHERE id = $1`,
                        [tx.id]
                    );
                    console.log(`🗑️ Deleted misfired processing transaction ID ${tx.id} for SKU ${sku}`);
                } catch (deleteError: any) {
                    console.error(`❌ Failed to delete misfired processing transaction ${tx.id}:`, deleteError.message);
                }
            }
        }

        // Get line items from webhook payload
        const allLineItems = payload.line_items;
        if (!allLineItems || !Array.isArray(allLineItems) || allLineItems.length === 0) {
            return NextResponse.json({ success: true, message: 'No line items in order' });
        }

        // Filter line items to only include those with valid SKUs
        const { validLineItems, skippedItems } = await filterValidLineItems(allLineItems, orderId, isTestEnvironment);

        // If no valid line items, don't process or log
        if (validLineItems.length === 0) {
            console.warn(`⚠️ Order #${orderId} has no valid line items (all SKUs are untracked or missing) - SKIPPING ORDER`);
            return NextResponse.json({
                success: true,
                message: 'Order skipped - no valid tracked SKUs',
                skippedItems: skippedItems.map((item: any) => ({
                    name: item.name,
                    sku: item.sku || '(empty)',
                    quantity: item.quantity
                }))
            });
        }

        const lineItems = validLineItems;

        // Get SKU mappings from database
        const allSingleSkus = await getAllSingleSkus();
        const allCombos = await getAllComboSkus();
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));
        const comboSkuMap = new Map(allCombos.map((c: any) => [c.sku, c]));

        // If test environment, also include dummy SKUs
        await addDummySkusToMaps(singleSkuMap, comboSkuMap, isTestEnvironment);

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

                        // NEW BEHAVIOR: Do NOT deduct from in_warehouse, only track pending counts
                        const inWarehouseBefore = currentState.inWarehouse;
                        const inWarehouseAfter = inWarehouseBefore; // No change to in_warehouse

                        // Update pending_consult or pending_review based on status
                        const pendingConsultBefore = currentState.pendingConsult;
                        const pendingReviewBefore = currentState.pendingReview;
                        const processingBefore = currentState.processing;

                        let pendingConsultAfter = pendingConsultBefore;
                        let pendingReviewAfter = pendingReviewBefore;

                        if (status === 'pending-consult') {
                            pendingConsultAfter = pendingConsultBefore + quantity;
                        } else {
                            pendingReviewAfter = pendingReviewBefore + quantity;
                        }

                        // Calculate available_for_purchase to check if we need to add backorder
                        const availableBefore = Math.max(0, inWarehouseBefore - pendingConsultBefore - pendingReviewBefore - processingBefore);
                        const availableAfter = Math.max(0, inWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingBefore);

                        // Backorder is now calculated: max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
                        // No need to manually track it - it's derived from current state
                        const backorderBefore = Math.max(0, (pendingConsultBefore + pendingReviewBefore + processingBefore) - inWarehouseBefore);
                        const backorderAfter = Math.max(0, (pendingConsultAfter + pendingReviewAfter + processingBefore) - inWarehouseAfter);

                        // Create transaction for pending-consult/pending-review
                        const transactionType = status === 'pending-consult' ? 'order_pending_consult' : 'order_pending_review';
                        await createStockTransaction({
                            sku,
                            singleSkuId: singleSku.id,
                            transactionType,
                            quantityChange: 0, // No change to in_warehouse
                            // Legacy fields (for backward compatibility)
                            stockBefore: inWarehouseBefore,
                            stockAfter: inWarehouseAfter,
                            pendingBefore: pendingConsultBefore + pendingReviewBefore,
                            pendingAfter: pendingConsultAfter + pendingReviewAfter,
                            // New fields
                            inWarehouseBefore,
                            inWarehouseAfter,
                            processingBefore,
                            processingAfter: processingBefore, // No change
                            pendingConsultBefore,
                            pendingConsultAfter,
                            pendingReviewBefore,
                            pendingReviewAfter,
                            backorderBefore,
                            backorderAfter,
                            sourceType: 'order',
                            sourceId: orderId,
                            sourceEvent: `order.${status}`,
                            details: {
                                quantity,
                                status,
                                isCombo: false,
                                orderId,
                                availableForPurchase: availableAfter
                            }
                        });

                        pendingStockUpdates.push({
                            sku,
                            quantity,
                            wcStock: inWarehouseAfter, // Use in_warehouse for display
                            isCombo: false
                        });

                        console.log(`✅ Created transaction for single SKU ${sku}: in_warehouse=${inWarehouseAfter} (no change), ${status}=${status === 'pending-consult' ? pendingConsultAfter : pendingReviewAfter}, available=${availableAfter}, backorder=${backorderAfter}`);
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

                                // NEW BEHAVIOR: Do NOT deduct from in_warehouse, only track pending counts
                                const inWarehouseBefore = currentState.inWarehouse;
                                const inWarehouseAfter = inWarehouseBefore; // No change to in_warehouse

                                // Update pending_consult or pending_review based on status
                                const pendingConsultBefore = currentState.pendingConsult;
                                const pendingReviewBefore = currentState.pendingReview;
                                const processingBefore = currentState.processing;

                                let pendingConsultAfter = pendingConsultBefore;
                                let pendingReviewAfter = pendingReviewBefore;

                                if (status === 'pending-consult') {
                                    pendingConsultAfter = pendingConsultBefore + deductedQty;
                                } else {
                                    pendingReviewAfter = pendingReviewBefore + deductedQty;
                                }

                                // Calculate available_for_purchase to check if we need to add backorder
                                const availableBefore = Math.max(0, inWarehouseBefore - pendingConsultBefore - pendingReviewBefore - processingBefore);
                                const availableAfter = Math.max(0, inWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingBefore);

                                // Backorder is now calculated: max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
                                // No need to manually track it - it's derived from current state
                                const backorderBefore = Math.max(0, (pendingConsultBefore + pendingReviewBefore + processingBefore) - inWarehouseBefore);
                                const backorderAfter = Math.max(0, (pendingConsultAfter + pendingReviewAfter + processingBefore) - inWarehouseAfter);

                                // Create transaction for pending-consult/pending-review (combo component)
                                const transactionType = status === 'pending-consult' ? 'order_pending_consult' : 'order_pending_review';
                                await createStockTransaction({
                                    sku: comp.sku,
                                    singleSkuId: componentSku.id,
                                    transactionType,
                                    quantityChange: 0, // No change to in_warehouse
                                    // Legacy fields (for backward compatibility)
                                    stockBefore: inWarehouseBefore,
                                    stockAfter: inWarehouseAfter,
                                    pendingBefore: pendingConsultBefore + pendingReviewBefore,
                                    pendingAfter: pendingConsultAfter + pendingReviewAfter,
                                    // New fields
                                    inWarehouseBefore,
                                    inWarehouseAfter,
                                    processingBefore,
                                    processingAfter: processingBefore, // No change
                                    pendingConsultBefore,
                                    pendingConsultAfter,
                                    pendingReviewBefore,
                                    pendingReviewAfter,
                                    backorderBefore,
                                    backorderAfter,
                                    sourceType: 'order',
                                    sourceId: orderId,
                                    sourceEvent: `order.${status}`,
                                    details: {
                                        deductedQty,
                                        status,
                                        isCombo: true,
                                        comboSku: sku,
                                        orderId,
                                        availableForPurchase: availableAfter
                                    }
                                });

                                // Sync stock to WooCommerce (async, don't block response)
                                syncStockToWooCommerce(comp.sku).catch(err => {
                                    console.error(`Error syncing ${comp.sku} to WooCommerce:`, err);
                                });

                                pendingStockUpdates.push({
                                    sku: comp.sku,
                                    quantity: deductedQty,
                                    wcStock: inWarehouseAfter, // Use in_warehouse for display
                                    isCombo: false // Track as component, not combo
                                });

                                console.log(`✅ Created transaction for combo component ${comp.sku}: in_warehouse=${inWarehouseAfter} (no change), ${status}=${status === 'pending-consult' ? pendingConsultAfter : pendingReviewAfter}, available=${availableAfter}, backorder=${backorderAfter}`);
                            } catch (e: any) {
                                console.error(`❌ Failed to track component ${comp.sku} for combo ${sku}:`, e.message);
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
                        stockMap[s] = currentState.inWarehouse; // Use in_warehouse for combo calculations
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
                currentStatus: status, // Track current status
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
                    note: `Order moved to ${statusLabel} (${status}). System tracking pending stock (no in_warehouse deduction). Updated combo availability.`
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
 * Handle nv-pending-pickup status: Final stage that deducts from in_warehouse
 * This is the ONLY webhook that deducts from in_warehouse
 * Also deducts from current status (processing, pending-consult, or pending-review)
 */
async function handleNvPendingPickup(orderId: number, payload: any, request: Request, isTestEnvironment: boolean = false) {
    try {
        console.log(`📦 Processing nv-pending-pickup for Order #${orderId} - deducting from in_warehouse and current status`);

        // IDEMPOTENCY PROTECTION: Check if this order was already processed for nv-pending-pickup
        // Prevents double deduction if webhook fires multiple times
        const previousNvPickupLog = await getWcWebhookLogByOrderId(orderId, 'order.nv-pending-pickup');
        if (previousNvPickupLog && previousNvPickupLog.success) {
            console.log(`⏭️ Order #${orderId} was already processed for nv-pending-pickup - skipping duplicate to prevent double stock deduction`);
            const previousNvPickupTime = new Date(previousNvPickupLog.created_at).toISOString();
            return NextResponse.json({
                success: true,
                message: `Order #${orderId} was already processed for nv-pending-pickup - skipping duplicate to prevent double stock deduction`,
                previousNvPickupTime,
                skipped: true
            });
        }

        // Get order's current status
        const currentStatus = await getOrderCurrentStatus(orderId);
        if (!currentStatus) {
            console.warn(`⚠️ Order #${orderId} has no current status - cannot determine what to deduct from`);
            // Still proceed, but we'll try to deduct from processing as default
        }

        // Get line items from webhook payload
        const allLineItems = payload.line_items;
        if (!allLineItems || !Array.isArray(allLineItems) || allLineItems.length === 0) {
            return NextResponse.json({ success: true, message: 'No line items in order' });
        }

        // Filter line items to only include those with valid SKUs
        const { validLineItems, skippedItems } = await filterValidLineItems(allLineItems, orderId, isTestEnvironment);

        // If no valid line items, don't process or log
        if (validLineItems.length === 0) {
            console.warn(`⚠️ Order #${orderId} has no valid line items (all SKUs are untracked or missing) - SKIPPING ORDER`);
            return NextResponse.json({
                success: true,
                message: 'Order skipped - no valid tracked SKUs',
                skippedItems: skippedItems.map((item: any) => ({
                    name: item.name,
                    sku: item.sku || '(empty)',
                    quantity: item.quantity
                }))
            });
        }

        const lineItems = validLineItems;

        // Get SKU mappings from database
        const allSingleSkus = await getAllSingleSkus();
        const allCombos = await getAllComboSkus();
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));
        const comboSkuMap = new Map(allCombos.map((c: any) => [c.sku, c]));

        // If test environment, also include dummy SKUs
        await addDummySkusToMaps(singleSkuMap, comboSkuMap, isTestEnvironment);

        // Track all SKUs that need to be deducted
        const skuQuantities = new Map<string, number>(); // sku -> total quantity

        for (const item of lineItems) {
            if (!item.sku) {
                console.warn(`⚠️ Order #${orderId} has line item without SKU: ${item.name || 'Unknown'}`);
                continue;
            }

            const sku = item.sku;
            const quantity = item.quantity || 0;

            // Process single SKU orders
            if (singleSkuMap.has(sku)) {
                skuQuantities.set(sku, (skuQuantities.get(sku) || 0) + quantity);
            }
            // Process combo SKU orders - break down to components
            else if (comboSkuMap.has(sku)) {
                const combo = comboSkuMap.get(sku);
                if (!combo) continue;

                const components = Array.isArray(combo.components)
                    ? combo.components
                    : JSON.parse(combo.components || '[]');

                for (const comp of components) {
                    if (!comp.sku || !comp.quantity) continue;
                    const deductedQty = comp.quantity * quantity;
                    skuQuantities.set(comp.sku, (skuQuantities.get(comp.sku) || 0) + deductedQty);
                }
            }
        }

        if (skuQuantities.size === 0) {
            return NextResponse.json({ success: true, message: 'No valid SKUs found in order' });
        }

        // Process deductions for each SKU
        const deductions: Array<{ sku: string; inWarehouseBefore: number; inWarehouseAfter: number; statusBefore: number; statusAfter: number; statusType: string }> = [];

        for (const [sku, totalQty] of skuQuantities.entries()) {
            const singleSku = singleSkuMap.get(sku);
            if (!singleSku) continue;

            try {
                const currentState = await getCurrentStockState(sku);

                // Get current status counts
                const inWarehouseBefore = currentState.inWarehouse;
                const processingBefore = currentState.processing;
                const pendingConsultBefore = currentState.pendingConsult;
                const pendingReviewBefore = currentState.pendingReview;

                // GUARDRAIL: Verify this order actually has stock in the status we're trying to deduct from
                // Get transactions for THIS order to see how much it contributed
                // For nv-pending-pickup, we need to check ALL possible statuses (processing, pending-consult, pending-review)
                // because the order might have gone directly from pending to nv-pending-pickup
                let orderProcessingQty = 0;
                let orderPendingConsultQty = 0;
                let orderPendingReviewQty = 0;
                let hasStatusStock = false; // Track if order has stock in any status
                let actualStatusType: 'processing' | 'pending-consult' | 'pending-review' | 'none' = 'none'; // Track which status has stock

                // Use NET SUM of all processing deltas for this order+sku.
                // This correctly handles orders that transitioned through pending→processing
                // AND survives mid-flight reconciliations (which reset global counters).
                // Using only the first tx would leave ghost stock if a reconciliation ran
                // between the order's pending and processing transactions.
                const orderProcessingTxs = await getStockTransactions({
                    sku,
                    sourceType: 'order',
                    sourceId: orderId,
                    transactionType: 'order_processing'
                });
                orderProcessingQty = Math.max(0, orderProcessingTxs.reduce((sum: number, tx: any) => {
                    return sum + ((tx.processing_after || 0) - (tx.processing_before || 0));
                }, 0));

                // Check pending-consult transactions (for orders that went from pending-consult to nv-pending-pickup)
                const orderPendingConsultTxs = await getStockTransactions({
                    sku,
                    sourceType: 'order',
                    sourceId: orderId,
                    transactionType: 'order_pending_consult'
                });
                orderPendingConsultQty = Math.max(0, orderPendingConsultTxs.reduce((sum: number, tx: any) => {
                    return sum + ((tx.pending_consult_after || 0) - (tx.pending_consult_before || 0));
                }, 0));

                // Check pending-review transactions (for orders that went from pending-review to nv-pending-pickup)
                const orderPendingReviewTxs = await getStockTransactions({
                    sku,
                    sourceType: 'order',
                    sourceId: orderId,
                    transactionType: 'order_pending_review'
                });
                orderPendingReviewQty = Math.max(0, orderPendingReviewTxs.reduce((sum: number, tx: any) => {
                    return sum + ((tx.pending_review_after || 0) - (tx.pending_review_before || 0));
                }, 0));

                // Determine which status has stock (priority: processing > pending-consult > pending-review)
                if (orderProcessingQty > 0) {
                    hasStatusStock = true;
                    actualStatusType = 'processing';
                    // Guardrail: Check if order has enough in processing
                    if (orderProcessingQty < totalQty) {
                        console.warn(`⚠️ Order #${orderId} trying to deduct ${totalQty} from processing, but order only has ${orderProcessingQty} in processing. Skipping deduction for ${sku}.`);
                        continue; // Skip this SKU - order doesn't have enough in processing
                    }
                } else if (orderPendingConsultQty > 0) {
                    hasStatusStock = true;
                    actualStatusType = 'pending-consult';
                    // Guardrail: Check if order has enough in pending-consult
                    if (orderPendingConsultQty < totalQty) {
                        console.warn(`⚠️ Order #${orderId} trying to deduct ${totalQty} from pending-consult, but order only has ${orderPendingConsultQty}. Skipping deduction for ${sku}.`);
                        continue;
                    }
                } else if (orderPendingReviewQty > 0) {
                    hasStatusStock = true;
                    actualStatusType = 'pending-review';
                    // Guardrail: Check if order has enough in pending-review
                    if (orderPendingReviewQty < totalQty) {
                        console.warn(`⚠️ Order #${orderId} trying to deduct ${totalQty} from pending-review, but order only has ${orderPendingReviewQty}. Skipping deduction for ${sku}.`);
                        continue;
                    }
                } else {
                    // No stock in any status - direct nv-pending-pickup (deduct from in_warehouse only)
                    hasStatusStock = false;
                    actualStatusType = 'none';
                }

                // Determine what status to deduct from based on where the stock actually is
                // Use actualStatusType which was determined by checking all possible statuses
                let statusType = actualStatusType;
                let statusBefore = 0;
                let statusAfter = 0;

                if (hasStatusStock) {
                    // Order has stock in a status - deduct from that status
                    if (actualStatusType === 'pending-consult') {
                        statusType = 'pending-consult';
                        statusBefore = pendingConsultBefore;
                        statusAfter = Math.max(0, pendingConsultBefore - totalQty);
                        console.log(`📦 Order #${orderId} ${sku}: Deducting from pending-consult and in_warehouse (${totalQty} units)`);
                    } else if (actualStatusType === 'pending-review') {
                        statusType = 'pending-review';
                        statusBefore = pendingReviewBefore;
                        statusAfter = Math.max(0, pendingReviewBefore - totalQty);
                        console.log(`📦 Order #${orderId} ${sku}: Deducting from pending-review and in_warehouse (${totalQty} units)`);
                    } else {
                        // Default to processing
                        statusType = 'processing';
                        statusBefore = processingBefore;
                        statusAfter = Math.max(0, processingBefore - totalQty);
                        console.log(`📦 Order #${orderId} ${sku}: Deducting from processing and in_warehouse (${totalQty} units)`);
                    }
                } else {
                    // Order has no stock in any status - direct nv-pending-pickup
                    // Don't deduct from status, only from in_warehouse
                    statusType = 'none'; // No status deduction
                    statusBefore = 0;
                    statusAfter = 0;
                    console.log(`📦 Order #${orderId} ${sku}: Direct nv-pending-pickup (no prior status) - deducting ${totalQty} from in_warehouse only`);
                }

                // Deduct from in_warehouse (physical stock)
                const inWarehouseAfter = Math.max(0, inWarehouseBefore - totalQty);

                // Update status counts
                let processingAfter = processingBefore;
                let pendingConsultAfter = pendingConsultBefore;
                let pendingReviewAfter = pendingReviewBefore;

                if (statusType === 'processing') {
                    processingAfter = statusAfter;
                } else if (statusType === 'pending-consult') {
                    pendingConsultAfter = statusAfter;
                } else if (statusType === 'pending-review') {
                    pendingReviewAfter = statusAfter;
                } else if (statusType === 'none') {
                    // No status change - direct deduction from in_warehouse
                    // Keep status counts unchanged
                } else if (statusType === 'none') {
                    // No status change - direct deduction from in_warehouse
                    // Keep status counts unchanged
                }

                // Calculate available_for_purchase
                const availableAfter = Math.max(0, inWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingAfter);

                // Backorder is now calculated: max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
                // No need to manually track it - it's derived from current state
                const backorderBefore = Math.max(0, (pendingConsultBefore + pendingReviewBefore + processingBefore) - inWarehouseBefore);
                const backorderAfter = Math.max(0, (pendingConsultAfter + pendingReviewAfter + processingAfter) - inWarehouseAfter);

                // Create transaction
                await createStockTransaction({
                    sku,
                    singleSkuId: singleSku.id,
                    transactionType: 'order_nv_pending_pickup',
                    quantityChange: -totalQty, // Negative = deduction from in_warehouse
                    // Legacy fields
                    stockBefore: inWarehouseBefore,
                    stockAfter: inWarehouseAfter,
                    pendingBefore: pendingConsultBefore + pendingReviewBefore,
                    pendingAfter: pendingConsultAfter + pendingReviewAfter,
                    // New fields
                    inWarehouseBefore,
                    inWarehouseAfter,
                    processingBefore,
                    processingAfter,
                    pendingConsultBefore,
                    pendingConsultAfter,
                    pendingReviewBefore,
                    pendingReviewAfter,
                    backorderBefore,
                    backorderAfter,
                    sourceType: 'order',
                    sourceId: orderId,
                    sourceEvent: 'order.nv-pending-pickup',
                    details: {
                        quantity: totalQty,
                        deductedFromStatus: statusType,
                        orderId,
                        availableForPurchase: availableAfter
                    }
                });

                // Sync stock to WooCommerce (async, don't block response)
                syncStockToWooCommerce(sku).catch(err => {
                    console.error(`Error syncing ${sku} to WooCommerce:`, err);
                });

                deductions.push({
                    sku,
                    inWarehouseBefore,
                    inWarehouseAfter,
                    statusBefore,
                    statusAfter,
                    statusType
                });

                console.log(`✅ Created transaction for ${sku}: in_warehouse ${inWarehouseBefore}→${inWarehouseAfter}, ${statusType} ${statusBefore}→${statusAfter}`);
            } catch (e: any) {
                console.error(`❌ Failed to create transaction for ${sku}:`, e.message);
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
                webhookEvent: 'order.nv-pending-pickup',
                entityId: orderId,
                entityName: `Order #${orderId}`,
                entitySku: firstSku,
                status: 'nv-pending-pickup',
                currentStatus: 'nv-pending-pickup',
                affectedSkus: orderSkus,
                details: {
                    orderId,
                    status: 'nv-pending-pickup',
                    previousStatus: currentStatus,
                    lineItems: lineItems.map((item: any) => ({
                        sku: item.sku,
                        name: item.name,
                        quantity: item.quantity
                    })),
                    deductions: deductions.map(d => ({
                        sku: d.sku,
                        inWarehouseBefore: d.inWarehouseBefore,
                        inWarehouseAfter: d.inWarehouseAfter,
                        statusType: d.statusType,
                        statusBefore: d.statusBefore,
                        statusAfter: d.statusAfter
                    })),
                    note: `Order moved to nv-pending-pickup. Deducted from in_warehouse and ${currentStatus || 'processing'} status.`
                },
                ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
                userAgent,
                success: true
            });
        } catch (logError: any) {
            console.error(`❌ Failed to log webhook for Order #${orderId}:`, logError.message);
        }

        // Check for low stock alerts (async, don't block response)
        const affectedSkus = deductions.map((d: any) => d.sku);
        checkAndSendLowStockAlerts(affectedSkus).catch(err => {
            console.error('Error checking low stock alerts:', err);
        });

        return NextResponse.json({
            success: true,
            message: 'nv-pending-pickup processed. Deducted from in_warehouse and current status.',
            deductions: deductions.length
        });

    } catch (error: any) {
        console.error('nv-pending-pickup Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

/**
 * Handle order cancellation: Restore stock that was deducted
 * Only restores stock if:
 * 1. Order was previously in "processing" status (stock was deducted)
 * 2. Order date is after January 1, 2026
 */
async function handleOrderCancellation(orderId: number, payload: any, request?: Request, isTestEnvironment: boolean = false) {
    try {
        console.log(`🔄 Processing cancellation for Order #${orderId}`);

        // Get order's current status
        const currentStatus = await getOrderCurrentStatus(orderId);
        console.log(`📋 Order #${orderId} current status: ${currentStatus || 'unknown'}`);

        // Check if order was in nv-pending-pickup (stock was deducted from in_warehouse)
        const nvPickupLog = await getWcWebhookLogByOrderId(orderId, 'order.nv-pending-pickup');
        const wasInNvPickup = nvPickupLog !== null;

        // Check if order was in processing
        const previousProcessingLog = await getWcWebhookLogByOrderId(orderId, 'order.processing');
        const wasInProcessing = previousProcessingLog !== null;

        // If order was never in processing or nv-pending-pickup, it might have been cancelled from pending
        // In that case, we just remove from pending (no in_warehouse restoration needed)
        if (!wasInProcessing && !wasInNvPickup) {
            console.log(`⏭️ Order #${orderId} was never in processing or nv-pending-pickup - checking if it was in pending`);
            // This might be handled by handlePendingCancellation, but let's check
            const previousPendingConsultLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-consult');
            const previousPendingReviewLog = await getWcWebhookLogByOrderId(orderId, 'order.pending-review');
            if (previousPendingConsultLog || previousPendingReviewLog) {
                // This should have been handled by handlePendingCancellation, but if we're here, handle it
                console.log(`📋 Order #${orderId} was in pending - removing from pending (no in_warehouse restoration)`);
                // This will be handled below
            } else {
                return NextResponse.json({
                    success: true,
                    message: 'Order was never processed - no stock changes to reverse'
                });
            }
        }

        // If order was in nv-pending-pickup, restore in_warehouse (stock was deducted)
        // Also restore the status it was deducted from (processing/pending)
        const shouldRestoreInWarehouse = wasInNvPickup; // Restore if order was in nv-pending-pickup

        if (wasInNvPickup) {
            console.log(`✅ Order #${orderId} was in nv-pending-pickup - will restore in_warehouse and status`);
        } else if (wasInProcessing) {
            console.log(`✅ Order #${orderId} was in processing - will remove from processing (no in_warehouse restoration)`);
        } else {
            console.log(`✅ Order #${orderId} was in pending - will remove from pending (no in_warehouse restoration)`);
        }

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

        // If test environment, also include dummy SKUs
        await addDummySkusToMaps(singleSkuMap, comboSkuMap, isTestEnvironment);

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

                    // NEW BEHAVIOR: Only restore to in_warehouse if order was in nv-pending-pickup
                    const inWarehouseBefore = currentState.inWarehouse;
                    const inWarehouseAfter = shouldRestoreInWarehouse
                        ? inWarehouseBefore + totalQty  // Restore to in_warehouse
                        : inWarehouseBefore; // No change

                    // Get current status counts
                    const processingBefore = currentState.processing;
                    const pendingConsultBefore = currentState.pendingConsult;
                    const pendingReviewBefore = currentState.pendingReview;

                    // Determine what status to remove from based on order's current status
                    let processingAfter = processingBefore;
                    let pendingConsultAfter = pendingConsultBefore;
                    let pendingReviewAfter = pendingReviewBefore;

                    // Check what status this order is in for this SKU
                    // IMPORTANT: Check nv-pending-pickup first if order was shipped
                    const nvPickupTx = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_nv_pending_pickup',
                        limit: 1
                    });
                    const processingTx = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_processing',
                        limit: 1
                    });
                    const pendingConsultTx = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_pending_consult',
                        limit: 1
                    });
                    const pendingReviewTx = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_pending_review',
                        limit: 1
                    });

                    // Determine which status has the quantity for this order
                    // Priority: nv-pending-pickup > processing > pending-consult > pending-review
                    if (nvPickupTx.length > 0 && wasInNvPickup) {
                        // Order was in nv-pending-pickup and now cancelled
                        // Restore in_warehouse and the status it was deducted from
                        const nvTx = nvPickupTx[0];
                        const details = typeof nvTx.details === 'string' ? JSON.parse(nvTx.details) : (nvTx.details || {});
                        const deductedFromStatus = details.deductedFromStatus || 'processing';

                        // Restore in_warehouse (always deducted in nv-pending-pickup)
                        // This is already set above via shouldRestoreInWarehouse

                        // Restore the status it was deducted from
                        if (deductedFromStatus === 'processing') {
                            const qtyDeducted = nvTx.processing_before - nvTx.processing_after;
                            if (qtyDeducted > 0) {
                                processingAfter = processingBefore + qtyDeducted;
                                console.log(`🔄 Restoring ${qtyDeducted} to processing and ${totalQty} to in_warehouse for ${sku} (cancelled from nv-pending-pickup)`);
                            }
                        } else if (deductedFromStatus === 'pending-consult') {
                            const qtyDeducted = nvTx.pending_consult_before - nvTx.pending_consult_after;
                            if (qtyDeducted > 0) {
                                pendingConsultAfter = pendingConsultBefore + qtyDeducted;
                                console.log(`🔄 Restoring ${qtyDeducted} to pending-consult and ${totalQty} to in_warehouse for ${sku} (cancelled from nv-pending-pickup)`);
                            }
                        } else if (deductedFromStatus === 'pending-review') {
                            const qtyDeducted = nvTx.pending_review_before - nvTx.pending_review_after;
                            if (qtyDeducted > 0) {
                                pendingReviewAfter = pendingReviewBefore + qtyDeducted;
                                console.log(`🔄 Restoring ${qtyDeducted} to pending-review and ${totalQty} to in_warehouse for ${sku} (cancelled from nv-pending-pickup)`);
                            }
                        } else if (deductedFromStatus === 'none') {
                            // Direct nv-pending-pickup - only restore in_warehouse, no status restoration
                            console.log(`🔄 Restoring ${totalQty} to in_warehouse for ${sku} (cancelled from direct nv-pending-pickup, no status restoration)`);
                        }
                    } else if (processingTx.length > 0 && processingTx[0].processing_after > processingTx[0].processing_before) {
                        const qtyInProcessing = processingTx[0].processing_after - processingTx[0].processing_before;
                        processingAfter = Math.max(0, processingBefore - qtyInProcessing);
                    } else if (pendingConsultTx.length > 0 && pendingConsultTx[0].pending_consult_after > pendingConsultTx[0].pending_consult_before) {
                        const qtyInPendingConsult = pendingConsultTx[0].pending_consult_after - pendingConsultTx[0].pending_consult_before;
                        pendingConsultAfter = Math.max(0, pendingConsultBefore - qtyInPendingConsult);
                    } else if (pendingReviewTx.length > 0 && pendingReviewTx[0].pending_review_after > pendingReviewTx[0].pending_review_before) {
                        const qtyInPendingReview = pendingReviewTx[0].pending_review_after - pendingReviewTx[0].pending_review_before;
                        pendingReviewAfter = Math.max(0, pendingReviewBefore - qtyInPendingReview);
                    }

                    // Calculate available_for_purchase
                    const availableAfter = Math.max(0, inWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingAfter);

                    // Backorder is now calculated: max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
                    // No need to manually track it - it's derived from current state
                    const backorderBefore = Math.max(0, (pendingConsultBefore + pendingReviewBefore + processingBefore) - inWarehouseBefore);
                    const backorderAfter = Math.max(0, (pendingConsultAfter + pendingReviewAfter + processingAfter) - inWarehouseAfter);

                    // Create transaction to restore stock
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku.id,
                        transactionType: 'order_cancelled',
                        quantityChange: shouldRestoreInWarehouse ? totalQty : 0, // Only change in_warehouse if restoring
                        // Legacy fields
                        stockBefore: inWarehouseBefore,
                        stockAfter: inWarehouseAfter,
                        pendingBefore: pendingConsultBefore + pendingReviewBefore,
                        pendingAfter: pendingConsultAfter + pendingReviewAfter,
                        // New fields
                        inWarehouseBefore,
                        inWarehouseAfter,
                        processingBefore,
                        processingAfter,
                        pendingConsultBefore,
                        pendingConsultAfter,
                        pendingReviewBefore,
                        pendingReviewAfter,
                        backorderBefore,
                        backorderAfter,
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: 'order.cancelled',
                        details: {
                            restoredQty: shouldRestoreInWarehouse ? totalQty : 0,
                            removedFromStatus: currentStatus,
                            changeMadeBy: 'HIS',
                            orderId,
                            isComboComponent: true,
                            availableForPurchase: availableAfter
                        }
                    });

                    // Sync stock to WooCommerce (async, don't block response)
                    syncStockToWooCommerce(sku).catch(err => {
                        console.error(`Error syncing ${sku} to WooCommerce:`, err);
                    });

                    restoredUpdates.push({
                        sku,
                        previousStock: inWarehouseBefore,
                        newStock: inWarehouseAfter,
                        restoredQty: totalQty,
                        changeMadeBy: 'HIS' // HIS system always restores combo component stocks
                    });

                    console.log(`✅ Restored ${totalQty} to ${sku} (${inWarehouseBefore} → ${inWarehouseAfter}) via database transaction`);
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
                    // Get current stock state from database (source of truth)
                    const currentState = await getCurrentStockState(sku);

                    // Restore to in_warehouse if order was in nv-pending-pickup
                    const inWarehouseBefore = currentState.inWarehouse;
                    const inWarehouseAfter = shouldRestoreInWarehouse
                        ? inWarehouseBefore + restoreQty  // Restore to in_warehouse
                        : inWarehouseBefore; // No change

                    // Get current status counts
                    const processingBefore = currentState.processing;
                    const pendingConsultBefore = currentState.pendingConsult;
                    const pendingReviewBefore = currentState.pendingReview;

                    // Determine what status to remove from based on order's current status
                    let processingAfter = processingBefore;
                    let pendingConsultAfter = pendingConsultBefore;
                    let pendingReviewAfter = pendingReviewBefore;

                    // Check what status this order is in for this SKU
                    // IMPORTANT: Check nv-pending-pickup first if order was shipped
                    const nvPickupTx = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_nv_pending_pickup',
                        limit: 1
                    });
                    const processingTx = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_processing',
                        limit: 1
                    });
                    const pendingConsultTx = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_pending_consult',
                        limit: 1
                    });
                    const pendingReviewTx = await getStockTransactions({
                        sku,
                        sourceId: orderId,
                        transactionType: 'order_pending_review',
                        limit: 1
                    });

                    // Determine which status has the quantity for this order
                    // Priority: nv-pending-pickup > processing > pending-consult > pending-review
                    if (nvPickupTx.length > 0 && wasInNvPickup) {
                        // Order was in nv-pending-pickup and now cancelled
                        // Restore in_warehouse and the status it was deducted from
                        const nvTx = nvPickupTx[0];
                        const details = typeof nvTx.details === 'string' ? JSON.parse(nvTx.details) : (nvTx.details || {});
                        const deductedFromStatus = details.deductedFromStatus || 'processing';

                        // Restore in_warehouse (always deducted in nv-pending-pickup)
                        // This is already set above via shouldRestoreInWarehouse

                        // Restore the status it was deducted from
                        if (deductedFromStatus === 'processing') {
                            const qtyDeducted = nvTx.processing_before - nvTx.processing_after;
                            if (qtyDeducted > 0) {
                                processingAfter = processingBefore + qtyDeducted;
                                console.log(`🔄 Restoring ${qtyDeducted} to processing and ${restoreQty} to in_warehouse for ${sku} (cancelled from nv-pending-pickup)`);
                            }
                        } else if (deductedFromStatus === 'pending-consult') {
                            const qtyDeducted = nvTx.pending_consult_before - nvTx.pending_consult_after;
                            if (qtyDeducted > 0) {
                                pendingConsultAfter = pendingConsultBefore + qtyDeducted;
                                console.log(`🔄 Restoring ${qtyDeducted} to pending-consult and ${restoreQty} to in_warehouse for ${sku} (cancelled from nv-pending-pickup)`);
                            }
                        } else if (deductedFromStatus === 'pending-review') {
                            const qtyDeducted = nvTx.pending_review_before - nvTx.pending_review_after;
                            if (qtyDeducted > 0) {
                                pendingReviewAfter = pendingReviewBefore + qtyDeducted;
                                console.log(`🔄 Restoring ${qtyDeducted} to pending-review and ${restoreQty} to in_warehouse for ${sku} (cancelled from nv-pending-pickup)`);
                            }
                        } else if (deductedFromStatus === 'none') {
                            // Direct nv-pending-pickup - only restore in_warehouse, no status restoration
                            console.log(`🔄 Restoring ${restoreQty} to in_warehouse for ${sku} (cancelled from direct nv-pending-pickup, no status restoration)`);
                        }
                    } else if (processingTx.length > 0 && processingTx[0].processing_after > processingTx[0].processing_before) {
                        const qtyInProcessing = processingTx[0].processing_after - processingTx[0].processing_before;
                        processingAfter = Math.max(0, processingBefore - qtyInProcessing);
                    } else if (pendingConsultTx.length > 0 && pendingConsultTx[0].pending_consult_after > pendingConsultTx[0].pending_consult_before) {
                        const qtyInPendingConsult = pendingConsultTx[0].pending_consult_after - pendingConsultTx[0].pending_consult_before;
                        pendingConsultAfter = Math.max(0, pendingConsultBefore - qtyInPendingConsult);
                    } else if (pendingReviewTx.length > 0 && pendingReviewTx[0].pending_review_after > pendingReviewTx[0].pending_review_before) {
                        const qtyInPendingReview = pendingReviewTx[0].pending_review_after - pendingReviewTx[0].pending_review_before;
                        pendingReviewAfter = Math.max(0, pendingReviewBefore - qtyInPendingReview);
                    }

                    // Calculate available_for_purchase
                    const availableAfter = Math.max(0, inWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingAfter);

                    // Backorder is now calculated: max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
                    // No need to manually track it - it's derived from current state
                    const backorderBefore = Math.max(0, (pendingConsultBefore + pendingReviewBefore + processingBefore) - inWarehouseBefore);
                    const backorderAfter = Math.max(0, (pendingConsultAfter + pendingReviewAfter + processingAfter) - inWarehouseAfter);

                    // Create transaction to restore stock
                    await createStockTransaction({
                        sku,
                        singleSkuId: singleSku.id,
                        transactionType: 'order_cancelled',
                        quantityChange: shouldRestoreInWarehouse ? restoreQty : 0, // Only change in_warehouse if restoring
                        // Legacy fields
                        stockBefore: inWarehouseBefore,
                        stockAfter: inWarehouseAfter,
                        pendingBefore: pendingConsultBefore + pendingReviewBefore,
                        pendingAfter: pendingConsultAfter + pendingReviewAfter,
                        // New fields
                        inWarehouseBefore,
                        inWarehouseAfter,
                        processingBefore,
                        processingAfter,
                        pendingConsultBefore,
                        pendingConsultAfter,
                        pendingReviewBefore,
                        pendingReviewAfter,
                        backorderBefore,
                        backorderAfter,
                        sourceType: 'order',
                        sourceId: orderId,
                        sourceEvent: 'order.cancelled',
                        details: {
                            restoredQty: shouldRestoreInWarehouse ? restoreQty : 0,
                            removedFromStatus: currentStatus,
                            changeMadeBy: 'HIS',
                            orderId,
                            availableForPurchase: availableAfter
                        }
                    });

                    // Sync stock to WooCommerce (async, don't block response)
                    syncStockToWooCommerce(sku).catch(err => {
                        console.error(`Error syncing ${sku} to WooCommerce:`, err);
                    });

                    wcSideRestorations.push({
                        sku,
                        previousStock: inWarehouseBefore,
                        newStock: inWarehouseAfter,
                        restoredQty: shouldRestoreInWarehouse ? restoreQty : 0,
                        changeMadeBy: 'HIS' // HIS handles restoration via database
                    } as any);

                    const action = shouldRestoreInWarehouse
                        ? `Restored ${restoreQty} to in_warehouse`
                        : `Removed from ${currentStatus || 'processing'}`;
                    console.log(`✅ ${action} for ${sku}: in_warehouse ${inWarehouseBefore}→${inWarehouseAfter}, ${currentStatus || 'processing'} removed`);

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
                        stockMap[sku] = currentState.inWarehouse; // Use in_warehouse for combo calculations
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
                        stockMap[s] = currentState.inWarehouse; // Use in_warehouse for combo calculations
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
                currentStatus: 'cancelled', // Track current status
                affectedSkus: orderSkus,
                comboUpdates: comboUpdates.map(u => ({ sku: u.sku, newStock: u.newStock })),
                details: {
                    orderId,
                    status: payload.status,
                    previousStatus: currentStatus,
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
                            changeMadeBy: r.changeMadeBy
                        })),
                        ...restoredUpdates.map(r => ({
                            sku: r.sku,
                            previousStock: r.previousStock,
                            newStock: r.newStock,
                            restoredQty: r.restoredQty,
                            changeMadeBy: r.changeMadeBy
                        }))
                    ],
                    comboUpdates: comboUpdates.map(u => ({ sku: u.sku, newStock: u.newStock })),
                    isEdgeCase: false, // No longer an edge case - normal cancellation handling
                    edgeCaseType: null,
                    note: shouldRestoreInWarehouse
                        ? `Order cancelled from ${currentStatus || 'nv-pending-pickup'}. Restored to in_warehouse and status.`
                        : `Order cancelled from ${currentStatus || 'processing'}. Removed from ${currentStatus || 'processing'} status (no in_warehouse restoration).`
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

        // Check for low stock alerts (async, don't block response)
        // Note: After cancellation, stock is restored, so we check if any SKUs are still low
        const allRestoredSkus = [
            ...restoredUpdates.map((u: any) => u.sku),
            ...wcSideRestorations.map((r: any) => r.sku)
        ];
        const uniqueRestoredSkus = Array.from(new Set(allRestoredSkus));
        checkAndSendLowStockAlerts(uniqueRestoredSkus).catch(err => {
            console.error('Error checking low stock alerts:', err);
        });

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

/**
 * Handle edge case: Order cancelled after nv-pending-pickup (shipped)
 * This should NOT restore stock - items are already out of warehouse
 * Just log it as an edge case for tracking
 */
async function logEdgeCaseCancellation(orderId: number, payload: any, request: Request | undefined, currentStatus: string | null, isTestEnvironment: boolean = false) {
    try {
        const lineItems = payload.line_items || [];
        const orderSkus = lineItems.map((item: any) => item.sku).filter(Boolean);
        const firstSku = orderSkus.length > 0 ? orderSkus[0] : undefined;

        const ipAddress = request?.headers.get('x-forwarded-for') ||
            request?.headers.get('x-real-ip') ||
            'unknown';
        const userAgent = request?.headers.get('user-agent') || 'unknown';

        await logWcWebhook({
            webhookType: 'order',
            webhookEvent: 'order.cancelled',
            entityId: orderId,
            entityName: `Order #${orderId}`,
            entitySku: firstSku,
            status: 'cancelled',
            currentStatus: 'cancelled',
            affectedSkus: orderSkus,
            details: {
                orderId,
                status: 'cancelled',
                previousStatus: currentStatus,
                lineItems: lineItems.map((item: any) => ({
                    sku: item.sku,
                    name: item.name,
                    quantity: item.quantity
                })),
                isEdgeCase: true,
                edgeCaseType: 'shipped_order_cancelled',
                note: `⚠️ EDGE CASE: Order cancelled after nv-pending-pickup (shipped). This is unexpected - shipped orders should be refunded, not cancelled. Stock was NOT restored because items are already out of warehouse.`
            },
            ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
            userAgent,
            success: true
        });

        return NextResponse.json({
            success: true,
            message: '⚠️ EDGE CASE: Order cancelled after nv-pending-pickup (shipped). Stock was NOT restored - items are already out of warehouse.',
            isEdgeCase: true,
            edgeCaseType: 'shipped_order_cancelled',
            note: 'Shipped orders should be refunded, not cancelled. No stock changes made.'
        });
    } catch (error: any) {
        console.error('Edge case cancellation log error:', error);
        return NextResponse.json({
            success: false,
            error: 'Failed to log edge case cancellation',
            message: error.message
        }, { status: 500 });
    }
}
