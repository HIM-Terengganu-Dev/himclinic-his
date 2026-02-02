import { NextResponse } from 'next/server';
import { requireAdmin, forbiddenResponse } from '@/lib/auth/middleware';

export async function POST(request: Request) {
  try {
    // Admin Role Check - Only admins can update stock
    const session = await requireAdmin(request);
    if (!session) {
      return forbiddenResponse();
    }

    return NextResponse.json(
      { success: false, error: 'This endpoint is disabled. Use /api/procurement/update instead to update stock via database transactions.' },
      { status: 410 } // 410 Gone - endpoint no longer available
    );
  } catch (error) {
    console.error('Error in stock update API:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update stock' },
      { status: 500 }
    );
  }
}










