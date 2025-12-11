import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { updateProductStock, getProduct, getOrders } from '@/lib/services/woocommerce';
import { getSingleSkuByCode, getAllComboSkus, getAllSingleSkus, logActivity } from '@/lib/db/queries';

export async function POST(request: Request) {
    try {
        const bodyText = await request.text();
        const signature = request.headers.get('x-wc-webhook-signature');
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

        // We only care about orders that are 'processing' (paid) or 'on-hold' (reserved)
        // or 'cancelled'/'refunded' (to restock - future improvement)
        // For now, let's focus on 'processing' to deduct stock.
        // NOTE: WC usually deducts stock automatically on 'processing'.

        // Our MAIN GOAL: Sync Combo SKU Availabilities based on Single SKU changes.
        // If an order contains a Single SKU, we must recalculate Combos that use it.

        console.log(`Processing webhook for Order #${orderId} (${status})`);

        // Get all line items
        const lineItems = payload.line_items;
        if (!lineItems || lineItems.length === 0) {
            return NextResponse.json({ success: true, message: 'No items' });
        }

        // Identify changed SKUs
        const changedSkus = new Set<string>();

        for (const item of lineItems) {
            if (item.sku) changedSkus.add(item.sku);
        }

        if (changedSkus.size === 0) {
            return NextResponse.json({ success: true, message: 'No SKUs found' });
        }

        // 1. Get All Combos from DB
        const allCombos = await getAllComboSkus();
        const allSingleSkus = await getAllSingleSkus();
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));

        // 2. Identify Affected Combos
        // Combos that contain any of the bought Single SKUs as components
        const affectedCombos = allCombos.filter((c: any) =>
            c.components.some((comp: any) => changedSkus.has(comp.sku))
        );

        if (affectedCombos.length === 0) {
            return NextResponse.json({ success: true, message: 'No affected combos' });
        }

        console.log(`Found ${affectedCombos.length} affected combos: ${affectedCombos.map((c: any) => c.sku).join(', ')}`);

        // 3. Recalculate & Update WC for each affected combo
        const updates = [];

        for (const combo of affectedCombos) {
            // Need current stock of ALL components for this combo
            // We must fetch from WC to be safe (Source of Truth)

            let comboLimit = Infinity;

            // For each component in the combo
            for (const comp of combo.components) {
                // Fetch current stock from WC
                // Optimization: Dedupe fetches if multiple combos use same component
                let stock = 0;
                try {
                    // If we have the WC ID, use it
                    const singleSkuData = singleSkuMap.get(comp.sku);
                    if (singleSkuData) {
                        const p = await getProduct(singleSkuData.woocommerce_product_id);
                        stock = p.stock_quantity || 0;
                    } else {
                        // Fallback if not mapped (shouldn't happen for valid items)
                        console.warn(`SKU ${comp.sku} not found in local DB mapping`);
                    }
                } catch (e) {
                    console.error(`Failed to fetch stock for ${comp.sku}`, e);
                    comboLimit = 0; // Fail safe
                    break;
                }

                const canMake = Math.floor(stock / comp.quantity);
                if (canMake < comboLimit) comboLimit = canMake;
            }

            if (comboLimit === Infinity) comboLimit = 0;

            // Update WC
            try {
                await updateProductStock(combo.woocommerce_product_id, comboLimit);
                updates.push({ sku: combo.sku, newStock: comboLimit });
                console.log(`Updated Combo ${combo.sku} to ${comboLimit}`);
            } catch (e) {
                console.error(`Failed to update combo ${combo.sku}`, e);
            }
        }

        // Log Activity
        await logActivity({
            userId: 'system-webhook', // Special system user
            action: 'webhook_sync',
            entityType: 'order',
            entityId: orderId,
            details: { orderId, status, updates },
            success: true
        });

        return NextResponse.json({ success: true, updates });

    } catch (error) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
