import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getDummyComboSkus, getDummySingleSkus, getSingleSkuByCode, getComboSkuByCode } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * Test endpoint to manually trigger webhook events
 * This creates a simulated webhook request and forwards it to the real webhook handler
 */
export async function POST(request: NextRequest) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only allow dev role to use test endpoint
        if (session.user?.role !== 'dev') {
            return NextResponse.json({ error: 'Forbidden: Dev access required' }, { status: 403 });
        }

        const body = await request.json();
        const { orderId, event, lineItems } = body;

        if (!orderId || !event || !lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
            return NextResponse.json({ 
                error: 'Invalid request: orderId, event, and lineItems are required' 
            }, { status: 400 });
        }

        // Validate event type
        const validEvents = [
            'order.pending-consult',
            'order.pending-review',
            'order.processing',
            'order.nv-pending-pickup',
            'order.cancelled'
        ];

        if (!validEvents.includes(event)) {
            return NextResponse.json({ 
                error: `Invalid event type. Must be one of: ${validEvents.join(', ')}` 
            }, { status: 400 });
        }

        // Filter valid line items - ONLY allow dummy SKUs for testing
        const validLineItems: any[] = [];
        const invalidSkus: string[] = [];

        for (const item of lineItems) {
            if (!item.sku || item.sku.trim() === '') {
                invalidSkus.push(item.sku || '(empty)');
                continue;
            }
            
            const sku = item.sku.trim();
            
            // Check if it's a dummy SKU by querying the database
            const singleSku = await getSingleSkuByCode(sku);
            const comboSku = singleSku ? null : await getComboSkuByCode(sku);
            const skuRecord = singleSku || comboSku;
            
            if (!skuRecord) {
                invalidSkus.push(sku);
                continue;
            }
            
            // Verify it's a dummy SKU
            const isDummySku = skuRecord.description && skuRecord.description.toLowerCase() === 'dummy sku';
            if (isDummySku) {
                validLineItems.push(item);
            } else {
                invalidSkus.push(sku);
            }
        }

        if (invalidSkus.length > 0) {
            return NextResponse.json({ 
                error: `The following SKUs are not dummy SKUs and cannot be used in test environment: ${invalidSkus.join(', ')}. Only SKUs with description = "dummy sku" are allowed.`,
                invalidSkus
            }, { status: 400 });
        }

        if (validLineItems.length === 0) {
            return NextResponse.json({ 
                error: 'No valid dummy SKUs found in line items. Test environment only accepts SKUs with description = "dummy sku".'
            }, { status: 400 });
        }

        // Map event to status field (webhook handler uses status field to determine event)
        let status: string;
        if (event === 'order.processing') {
            status = 'processing';
        } else if (event === 'order.pending-consult') {
            status = 'pending-consult';
        } else if (event === 'order.pending-review') {
            status = 'pending-review';
        } else if (event === 'order.nv-pending-pickup') {
            status = 'nv-pending-pickup';
        } else if (event === 'order.cancelled') {
            status = 'cancelled';
        } else {
            status = 'pending';
        }

        // Create a simulated webhook payload matching WooCommerce format
        const simulatedPayload = {
            id: orderId,
            status: status,
            line_items: validLineItems.map((item: any) => ({
                id: item.id || Math.floor(Math.random() * 100000),
                sku: item.sku,
                name: item.name || item.sku,
                quantity: item.quantity || 1,
                product_id: item.productId || Math.floor(Math.random() * 1000)
            }))
        };

        // Create a simulated request to forward to the webhook handler
        // The webhook handler expects the body as text for signature verification
        const bodyText = JSON.stringify(simulatedPayload);
        const webhookUrl = new URL('/api/webhooks/orders', request.url);
        const webhookRequest = new Request(webhookUrl.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-wc-webhook-event': event,
                'x-wc-webhook-source': 'test-environment',
                // Don't send signature header - webhook handler will proceed without verification
                // when signature is missing (as per the handler's fallback logic)
            },
            body: bodyText
        });

        // Forward to the real webhook handler
        const webhookModule = await import('@/app/api/webhooks/orders/route');
        const response = await webhookModule.POST(webhookRequest);

        // Parse the response
        const responseData = await response.json();

        return NextResponse.json({
            success: response.ok && responseData.success !== false,
            message: responseData.message || responseData.error || 'Test event processed',
            details: responseData
        });
    } catch (error: any) {
        console.error('Test webhook error:', error);
        return NextResponse.json({ 
            success: false,
            error: 'Internal server error',
            message: error.message || 'Failed to process test webhook'
        }, { status: 500 });
    }
}
