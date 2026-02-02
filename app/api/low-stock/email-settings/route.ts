import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { getLowStockEmailSettings, updateLowStockEmailSettings } from '@/lib/db/queries';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const settings = await getLowStockEmailSettings();
        return NextResponse.json({ success: true, settings });
    } catch (error: any) {
        console.error('Error fetching low stock email settings:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { enabled, recipientEmail, senderEmail, emailSubject, emailBody } = body;

        const settings = await updateLowStockEmailSettings({
            enabled,
            recipientEmail,
            senderEmail,
            emailSubject,
            emailBody
        });

        return NextResponse.json({ success: true, settings });
    } catch (error: any) {
        console.error('Error updating low stock email settings:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
