import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import { getAllUsers, createUser, getUserByEmail } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAdmin(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const users = await getAllUsers();
        return NextResponse.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching users:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await requireAdmin(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { email, name, role } = body;

        if (!email || !name) {
            return NextResponse.json({ error: 'Email and name are required' }, { status: 400 });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
        }

        // Validate role
        const validRoles = ['user', 'admin', 'dev'];
        const userRole = role || 'user';
        if (!validRoles.includes(userRole)) {
            return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, { status: 400 });
        }

        // Check if user already exists
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
        }

        // Create user
        const newUser = await createUser({
            email,
            name,
            role: userRole
        });

        // Log activity
        await logActivity({
            userId: session.user.id,
            action: 'user_created',
            entityType: 'user',
            entityId: newUser.id,
            details: { email, name, role: userRole },
            success: true
        });

        return NextResponse.json({ success: true, user: newUser });
    } catch (error: any) {
        console.error('Error creating user:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
