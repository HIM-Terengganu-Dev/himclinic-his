import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { updateProductStock, getProduct } from '@/lib/services/woocommerce';
import { getAllComboSkus, getAllSingleSkus, logWcWebhook } from '@/lib/db/queries';

export async function POST(request: Request) {
    console.log("!!! PRODUCT WEBHOOK HIT !!! Method:", request.method);
    try {
        const bodyText = await request.text();

        // Debug: Log all headers to find the signature
        const headersList = Object.fromEntries(request.headers.entries());
        console.log('Product Webhook Headers:', JSON.stringify(headersList, null, 2));

        const signature = request.headers.get('x-wc-webhook-signature') || request.headers.get('X-WC-Webhook-Signature');
        const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;

        if (!secret || !signature) {
            console.error('Product Webhook Error: Missing secret or signature', {
                hasSecret: !!secret,
                hasSignature: !!signature
            });
            return NextResponse.json({ error: 'Missing secret or signature' }, { status: 401 });
        }

        // Verify Signature
        const hash = crypto.createHmac('sha256', secret).update(bodyText).digest('base64');

        if (hash !== signature) {
            console.error('Product Webhook Error: Invalid signature', {
                received: signature,
                computed: hash,
                secretLength: secret.length
            });
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        const payload = JSON.parse(bodyText);
        const productId = payload.id;
        const stockQuantity = payload.stock_quantity;
        const sku = payload.sku;

        console.log(`Product Webhook: Product ID ${productId}, SKU: ${sku}, Stock: ${stockQuantity}`);

        // Get SKU mappings from database (source of truth)
        const allSingleSkus = await getAllSingleSkus();
        const allCombos = await getAllComboSkus();

        // Find if this product is a single SKU in our database
        const singleSku = allSingleSkus.find((s: any) => s.woocommerce_product_id === productId);

        if (!singleSku) {
            // This product is not a single SKU we track, skip it
            console.log(`Product ${productId} is not a tracked single SKU, skipping combo recalculation`);
            return NextResponse.json({ 
                success: true, 
                message: 'Product is not a tracked single SKU, no action needed' 
            });
        }

        console.log(`✅ Found single SKU ${singleSku.sku} (WC ID: ${productId}) - Stock updated to ${stockQuantity}`);

        // Find all combo SKUs that use this single SKU
        const affectedCombos = allCombos.filter((c: any) => {
            const components = Array.isArray(c.components) 
                ? c.components 
                : JSON.parse(c.components || '[]');
            return components.some((comp: any) => comp.sku === singleSku.sku);
        });

        if (affectedCombos.length === 0) {
            console.log(`No combo SKUs affected by ${singleSku.sku} stock change`);
            return NextResponse.json({ 
                success: true, 
                message: 'No combo SKUs affected by this single SKU' 
            });
        }

        console.log(`Recalculating ${affectedCombos.length} combo SKUs affected by ${singleSku.sku}`);

        // Build stock map for combo calculations
        const stockMap: Record<string, number> = {};
        stockMap[singleSku.sku] = stockQuantity || 0; // Use the updated stock from webhook

        // Collect all unique component SKUs needed for affected combos
        const neededSkus = new Set<string>();
        affectedCombos.forEach((c: any) => {
            const components = Array.isArray(c.components) 
                ? c.components 
                : JSON.parse(c.components || '[]');
            components.forEach((comp: any) => neededSkus.add(comp.sku));
        });

        // Fetch stock for other components needed for combo calculations
        const missingSkus = Array.from(neededSkus).filter(s => s !== singleSku.sku);
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));

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
        const comboUpdates: Array<{ sku: string; newStock: number }> = [];

        for (const combo of affectedCombos) {
            if (!combo.woocommerce_product_id) {
                console.warn(`⚠️ Combo ${combo.sku} missing WooCommerce product ID`);
                continue;
            }

            const components = Array.isArray(combo.components) 
                ? combo.components 
                : JSON.parse(combo.components || '[]');
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

        // Get IP address and user agent from request
        const ipAddress = request.headers.get('x-forwarded-for') || 
                         request.headers.get('x-real-ip') || 
                         'unknown';
        const userAgent = request.headers.get('user-agent') || 'unknown';

        // Log to WC Webhook Logs
        await logWcWebhook({
            webhookType: 'product',
            webhookEvent: 'product.updated',
            entityId: productId,
            entitySku: singleSku.sku,
            entityName: payload.name || singleSku.name || singleSku.sku,
            status: 'stock_reconciled',
            stockQuantity: stockQuantity,
            affectedSkus: [singleSku.sku],
            comboUpdates: comboUpdates.map(u => ({ 
                sku: u.sku, 
                newStock: u.newStock 
            })),
            details: { 
                productId,
                singleSku: singleSku.sku,
                newStock: stockQuantity,
                note: 'Product stock updated in WooCommerce. Combo SKU availability recalculated.',
                comboUpdates: comboUpdates.map(u => ({ sku: u.sku, newStock: u.newStock }))
            },
            ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
            userAgent,
            success: true
        });

        return NextResponse.json({ 
            success: true, 
            message: 'Combo SKU availability updated after product stock change',
            singleSku: singleSku.sku,
            newStock: stockQuantity,
            comboUpdates: comboUpdates.length
        });

    } catch (error) {
        console.error('Product Webhook Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


