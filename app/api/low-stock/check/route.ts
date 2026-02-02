import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { getSkusWithLowStock, getLowStockEmailSettings } from '@/lib/db/queries';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const lowStockSkus = await getSkusWithLowStock();
        return NextResponse.json({ success: true, lowStockSkus });
    } catch (error: any) {
        console.error('Error checking low stock:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        // This endpoint can be called by Vercel Cron (no auth required for cron)
        // But we'll add a secret check for security
        const authHeader = req.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;
        
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const emailSettings = await getLowStockEmailSettings();
        if (!emailSettings || !emailSettings.enabled) {
            return NextResponse.json({ success: true, message: 'Email alerts are disabled' });
        }

        const lowStockSkus = await getSkusWithLowStock();
        const allLowStock = [...lowStockSkus.single, ...lowStockSkus.combo];

        if (allLowStock.length === 0) {
            return NextResponse.json({ success: true, message: 'No low stock SKUs found' });
        }

        // Send email via API route
        const emailResponse = await fetch(`${req.nextUrl.origin}/api/low-stock/send-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cronSecret || 'internal'}`
            },
            body: JSON.stringify({
                lowStockSkus: allLowStock,
                emailSettings
            })
        });

        if (!emailResponse.ok) {
            throw new Error('Failed to send email');
        }

        return NextResponse.json({ 
            success: true, 
            message: `Email sent for ${allLowStock.length} low stock SKU(s)`,
            lowStockCount: allLowStock.length
        });
    } catch (error: any) {
        console.error('Error in low stock check:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
