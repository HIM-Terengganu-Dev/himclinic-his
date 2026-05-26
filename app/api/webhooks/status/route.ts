import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import wooCommerce from '@/lib/services/woocommerce';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Check if WooCommerce credentials are set
        if (!process.env.WOOCOMMERCE_STORE_URL || 
            !process.env.WOOCOMMERCE_CONSUMER_KEY || 
            !process.env.WOOCOMMERCE_CONSUMER_SECRET) {
            return NextResponse.json({ 
                success: false, 
                error: 'WooCommerce API credentials not configured on server'
            }, { status: 500 });
        }

        // Fetch all webhooks from WooCommerce REST API
        console.log('🔄 Fetching webhooks from WooCommerce REST API to check status...');
        const response = await wooCommerce.get('webhooks', { per_page: 100 });
        const webhooks = response.data || [];

        // Match webhook for either our active domain (himclinic-his.vercel.app) 
        // or the older domain (himclinic-inventory.vercel.app) to display correct diagnostics
        const matchedWebhooks = webhooks.filter((w: any) => 
            w.topic === 'order.updated' && 
            (w.delivery_url.includes('himclinic-his.vercel.app') || 
             w.delivery_url.includes('himclinic-inventory.vercel.app'))
        );

        if (matchedWebhooks.length === 0) {
            return NextResponse.json({ 
                success: true, 
                configured: false,
                message: 'No active or disabled order.updated webhooks found pointing to your Vercel domains.'
            });
        }

        // Find the one for our active domain (priority), otherwise fall back
        const activeHostWebhook = matchedWebhooks.find((w: any) => 
            w.delivery_url.includes('himclinic-his.vercel.app')
        ) || matchedWebhooks[0];

        return NextResponse.json({
            success: true,
            configured: true,
            webhook: {
                id: activeHostWebhook.id,
                name: activeHostWebhook.name,
                status: activeHostWebhook.status, // 'active', 'paused', 'disabled'
                delivery_url: activeHostWebhook.delivery_url,
                topic: activeHostWebhook.topic,
                created_at: activeHostWebhook.date_created,
                updated_at: activeHostWebhook.date_modified
            }
        });
    } catch (error: any) {
        console.error('Error checking WooCommerce webhooks status:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Failed to retrieve webhook status from WooCommerce',
            details: error.message
        }, { status: 500 });
    }
}
