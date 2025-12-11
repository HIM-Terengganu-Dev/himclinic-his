import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { updateProductStock, getProduct } from '@/lib/services/woocommerce';
import { getAllComboSkus, getAllSingleSkus, logActivity } from '@/lib/db/queries';
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

        // Calculate total deductions for each single SKU
        const totalDeductions: Record<string, number> = {};

        for (const item of lineItems) {
            if (!item.sku) {
                console.warn(`⚠️ Order #${orderId} has line item without SKU: ${item.name || 'Unknown'}`);
                continue;
            }

            const sku = item.sku;
            const quantity = item.quantity || 0;

            // Validate against database: Check if it's a single SKU
            if (singleSkuMap.has(sku)) {
                // Direct single SKU deduction
                totalDeductions[sku] = (totalDeductions[sku] || 0) + quantity;
                console.log(`✅ Found single SKU ${sku} in database, quantity: ${quantity}`);
            } 
            // Validate against database: Check if it's a combo SKU
            else if (comboSkuMap.has(sku)) {
                // Combo SKU: break down to component single SKUs from database
                const combo = comboSkuMap.get(sku);
                if (!combo) continue;

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
                }
                console.log(`✅ Found combo SKU ${sku} in database, breaking down to components`);
            } 
            else {
                // SKU not found in database - skip it
                console.warn(`⚠️ SKU ${sku} from order #${orderId} not found in database (not a single or combo SKU)`);
            }
        }

        if (Object.keys(totalDeductions).length === 0) {
            return NextResponse.json({ success: true, message: 'No valid SKUs found' });
        }

        console.log(`Processing webhook for Order #${orderId}: Deducting ${Object.keys(totalDeductions).length} single SKUs`);

        // 1. Update single SKU stock in WooCommerce
        const singleSkuUpdates: Array<{ sku: string; success: boolean; error?: string }> = [];

        for (const [sku, deductedQty] of Object.entries(totalDeductions)) {
            const singleSku = singleSkuMap.get(sku);
            if (!singleSku || !singleSku.woocommerce_product_id) {
                console.warn(`⚠️ SKU ${sku} not found in database or missing WooCommerce product ID`);
                singleSkuUpdates.push({ sku, success: false, error: 'SKU not found in database' });
                continue;
            }

            try {
                // Get current stock from WooCommerce
                const currentProduct = await getProduct(singleSku.woocommerce_product_id);
                const currentStock = currentProduct.stock_quantity || 0;
                const newStock = Math.max(0, currentStock - deductedQty); // Ensure non-negative

                // Update WooCommerce stock
                await updateProductStock(singleSku.woocommerce_product_id, newStock);
                console.log(`✅ Updated ${sku} in WooCommerce: ${currentStock} → ${newStock} (deducted ${deductedQty})`);
                singleSkuUpdates.push({ sku, success: true });
            } catch (error: any) {
                console.error(`❌ Failed to update ${sku} in WooCommerce:`, error.message);
                singleSkuUpdates.push({ sku, success: false, error: error.message });
            }
        }

        // 2. Recalculate and update combo SKU availability in WooCommerce
        // Note: allCombos already fetched above on line 57
        const affectedCombos = allCombos.filter((c: any) => {
            const components = Array.isArray(c.components) ? c.components : JSON.parse(c.components || '[]');
            return components.some((comp: any) => Object.keys(totalDeductions).includes(comp.sku));
        });

        const comboUpdates: Array<{ sku: string; newStock: number }> = [];

        if (affectedCombos.length > 0) {
            // Build stock map: use updated stock for deducted SKUs, fetch others from WooCommerce
            const stockMap: Record<string, number> = {};

            // Get updated stock for SKUs we just deducted
            for (const [sku, deductedQty] of Object.entries(totalDeductions)) {
                const singleSku = singleSkuMap.get(sku);
                if (singleSku && singleSku.woocommerce_product_id) {
                    try {
                        const p = await getProduct(singleSku.woocommerce_product_id);
                        stockMap[sku] = p.stock_quantity || 0; // Already updated above
                    } catch (e) {
                        console.warn(`Failed to fetch updated stock for ${sku}`, e);
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

        // Log Activity
        await logActivity({
            userId: 'system-webhook', // Special system user
            action: 'webhook_order_processed',
            entityType: 'order',
            entityId: orderId,
            details: { 
                orderId, 
                status, 
                singleSkuUpdates: singleSkuUpdates.filter(u => u.success).map(u => u.sku),
                comboUpdates: comboUpdates.map(u => u.sku)
            },
            success: true
        });

        return NextResponse.json({ 
            success: true, 
            singleSkuUpdates: singleSkuUpdates.filter(u => u.success).length,
            comboUpdates: comboUpdates.length
        });

    } catch (error) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
