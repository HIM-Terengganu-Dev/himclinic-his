import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAllComboSkus, getAllSingleSkus, logWcWebhook, getCurrentStockState } from '@/lib/db/queries';

export async function POST(request: Request) {
    console.log("!!! PRODUCT WEBHOOK HIT !!! Method:", request.method);
    try {
        const bodyText = await request.text();

        // Debug: Log all headers to find the signature
        const headersList = Object.fromEntries(request.headers.entries());
        console.log('Product Webhook Headers:', JSON.stringify(headersList, null, 2));

        // Try multiple header name variations (WooCommerce uses X-WC-Webhook-Signature)
        const signature = request.headers.get('x-wc-webhook-signature') || 
                         request.headers.get('X-WC-Webhook-Signature') ||
                         request.headers.get('X-WC-WEBHOOK-SIGNATURE') ||
                         (headersList as any)['x-wc-webhook-signature'] ||
                         (headersList as any)['X-WC-Webhook-Signature'];
        const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;

        if (!secret || !signature) {
            console.error('Product Webhook Error: Missing secret or signature', {
                hasSecret: !!secret,
                hasSignature: !!signature,
                allHeaderKeys: Object.keys(headersList),
                signatureHeaderPresent: 'x-wc-webhook-signature' in headersList || 'X-WC-Webhook-Signature' in headersList
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
        let stockQuantity = payload.stock_quantity;
        const sku = payload.sku;

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

        // Get previous stock quantity (before this update)
        // Note: WooCommerce webhook fires AFTER stock is updated, so we need to fetch current stock
        // which is now the new stock. Previous stock might be in payload or we calculate it.
        let previousStockQuantity: number | undefined = undefined;
        
        // Check if previous stock is in payload
        if (payload.previous_stock_quantity !== null && payload.previous_stock_quantity !== undefined) {
            previousStockQuantity = typeof payload.previous_stock_quantity === 'number' 
                ? payload.previous_stock_quantity 
                : parseFloat(String(payload.previous_stock_quantity)) || undefined;
        }
        
        // If stock_quantity is not in payload or is null/undefined, get it from our database (source of truth)
        if (stockQuantity === null || stockQuantity === undefined) {
            try {
                const currentState = await getCurrentStockState(singleSku.sku);
                stockQuantity = currentState.stock;
                // If we don't have previous stock, we can't calculate it (stock already updated)
                if (previousStockQuantity === undefined) {
                    previousStockQuantity = undefined; // Will be logged as null
                }
                console.log(`Product Webhook: Stock quantity not in payload, fetched from database: ${stockQuantity}`);
            } catch (e: any) {
                console.error(`Failed to fetch stock quantity for product ${productId}:`, e.message);
                stockQuantity = 0;
            }
        }

        // Ensure stockQuantity is a number
        stockQuantity = typeof stockQuantity === 'number' ? stockQuantity : (parseFloat(String(stockQuantity)) || 0);

        console.log(`Product Webhook: Product ID ${productId}, SKU: ${sku}, Stock: ${stockQuantity}`);
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

        // Build stock map for combo calculations from our database (source of truth)
        const stockMap: Record<string, number> = {};
        const stockMapBefore: Record<string, number> = {};
        stockMap[singleSku.sku] = stockQuantity || 0; // Use the updated stock from webhook
        stockMapBefore[singleSku.sku] = previousStockQuantity !== undefined ? previousStockQuantity : (stockQuantity || 0);

        // Collect all unique component SKUs needed for affected combos
        const neededSkus = new Set<string>();
        affectedCombos.forEach((c: any) => {
            const components = Array.isArray(c.components) 
                ? c.components 
                : JSON.parse(c.components || '[]');
            components.forEach((comp: any) => neededSkus.add(comp.sku));
        });

        // Fetch stock for other components needed for combo calculations from our database
        const missingSkus = Array.from(neededSkus).filter(s => s !== singleSku.sku);

        await Promise.all(missingSkus.map(async (s) => {
            try {
                const currentState = await getCurrentStockState(s);
                stockMap[s] = currentState.stock;
                stockMapBefore[s] = currentState.stock;
            } catch (e) {
                console.warn(`Failed to fetch stock for component ${s} from database`, e);
                stockMap[s] = 0;
                stockMapBefore[s] = 0;
            }
        }));

        // Calculate combo availability (for logging only - we don't update WooCommerce)
        const comboUpdates: Array<{ sku: string; previousStock?: number; newStock: number }> = [];

        for (const combo of affectedCombos) {
            const components = Array.isArray(combo.components) 
                ? combo.components 
                : JSON.parse(combo.components || '[]');
            let comboLimit = Infinity;
            let comboLimitBefore = Infinity;

            for (const comp of components) {
                const stock = stockMap[comp.sku] || 0;
                const canMake = Math.floor(stock / comp.quantity);
                if (canMake < comboLimit) comboLimit = canMake;

                const stockBefore = stockMapBefore[comp.sku] ?? stock;
                const canMakeBefore = Math.floor(stockBefore / comp.quantity);
                if (canMakeBefore < comboLimitBefore) comboLimitBefore = canMakeBefore;
            }

            if (comboLimit === Infinity) comboLimit = 0;
            if (comboLimitBefore === Infinity) comboLimitBefore = 0;

            comboUpdates.push({ sku: combo.sku, previousStock: comboLimitBefore, newStock: comboLimit });
            console.log(`📊 Calculated combo ${combo.sku} availability: ${comboLimitBefore} → ${comboLimit} units (logged only, not updated in WooCommerce)`);
        }

        // Get IP address and user agent from request
        const ipAddress = request.headers.get('x-forwarded-for') || 
                         request.headers.get('x-real-ip') || 
                         'unknown';
        const userAgent = request.headers.get('user-agent') || 'unknown';

        // Log to WC Webhook Logs
        try {
            await logWcWebhook({
                webhookType: 'product',
                webhookEvent: 'product.updated',
                entityId: productId,
                entitySku: singleSku.sku,
                entityName: payload.name || singleSku.name || singleSku.sku,
                status: 'stock_reconciled',
                stockQuantity: stockQuantity,
                previousStockQuantity: previousStockQuantity,
                affectedSkus: [singleSku.sku],
                comboUpdates: comboUpdates.map(u => ({ 
                    sku: u.sku, 
                    previousStock: u.previousStock,
                    newStock: u.newStock 
                })),
                details: { 
                    productId,
                    singleSku: singleSku.sku,
                    previousStock: previousStockQuantity,
                    newStock: stockQuantity,
                    note: 'Product stock updated in WooCommerce (webhook received). Combo SKU availability recalculated (logged only, not updated in WooCommerce).',
                    comboUpdates: comboUpdates.map(u => ({ sku: u.sku, previousStock: u.previousStock, newStock: u.newStock }))
                },
                ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim(),
                userAgent,
                success: true
            });
        } catch (logError: any) {
            // CRITICAL ERROR: Combo SKU availability was updated but logging failed!
            // IMPORTANT: We do NOT rollback or auto-reconcile. Combo updates remain in WooCommerce.
            // Manual reconciliation is required by the user. We only log the error for detection.
            console.error(`❌ CRITICAL: Failed to log product webhook for Product #${productId} (SKU: ${singleSku.sku})!`, {
                error: logError.message,
                productId,
                sku: singleSku.sku,
                previousStock: previousStockQuantity,
                newStock: stockQuantity
            });
            
            // Try to log the error to activity_logs as a fallback
            // This allows users to detect unlogged changes and manually reconcile
            try {
                await import('@/lib/db/queries').then(m => m.logActivity({
                    action: 'webhook_log_failed_product_update',
                    entityType: 'product',
                    entityId: productId,
                    details: {
                        productId,
                        sku: singleSku.sku,
                        previousStock: previousStockQuantity,
                        newStock: stockQuantity,
                        error: logError.message,
                        note: 'CRITICAL: Product webhook log failed. Combo SKU availability was updated but log failed. Manual reconciliation required.'
                    },
                    success: false,
                    errorMessage: `Product webhook log failed: ${logError.message}`
                }));
            } catch (fallbackError) {
                console.error('❌ Failed to log error to activity_logs as fallback:', fallbackError);
            }
        }

        return NextResponse.json({ 
            success: true, 
            message: 'Product webhook received and logged. Combo SKU availability calculated (not updated in WooCommerce).',
            singleSku: singleSku.sku,
            newStock: stockQuantity,
            comboUpdates: comboUpdates.length
        });

    } catch (error) {
        console.error('Product Webhook Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


