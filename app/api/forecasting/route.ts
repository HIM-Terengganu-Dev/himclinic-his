import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getForecastingData } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const windowDays = searchParams.get('windowDays') ? parseInt(searchParams.get('windowDays')!, 10) : 30;
        const leadTimeDays = searchParams.get('leadTimeDays') ? parseInt(searchParams.get('leadTimeDays')!, 10) : 14;
        const bufferDays = searchParams.get('bufferDays') ? parseInt(searchParams.get('bufferDays')!, 10) : 14;
        const cycleDays = searchParams.get('cycleDays') ? parseInt(searchParams.get('cycleDays')!, 10) : 30;
        const growthRate = searchParams.get('growthRate') ? parseFloat(searchParams.get('growthRate')!) : 0;

        const data = await getForecastingData({
            windowDays,
            leadTimeDays,
            bufferDays,
            cycleDays,
            growthRate,
        });

        return NextResponse.json({
            success: true,
            ...data,
        });
    } catch (error: any) {
        console.error('Error fetching forecasting data:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to fetch forecasting data' },
            { status: 500 }
        );
    }
}
