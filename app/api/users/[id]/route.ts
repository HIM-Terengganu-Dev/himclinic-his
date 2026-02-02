import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { getUserById, updateUser, deleteUser } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';

export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const id = parseInt(params.id);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
        }

        const user = await getUserById(id);
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, user });
    } catch (error) {
        console.error('Error fetching user:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const id = parseInt(params.id);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
        }

        // Prevent users from modifying themselves
        if (id === session.user.id) {
            return NextResponse.json({ error: 'You cannot modify your own account' }, { status: 400 });
        }

        const body = await req.json();
        const { name, role } = body;

        // Validate role if provided
        if (role !== undefined) {
            const validRoles = ['user', 'admin', 'dev'];
            if (!validRoles.includes(role)) {
                return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, { status: 400 });
            }
        }

        // Get user before update for logging
        const userBefore = await getUserById(id);
        if (!userBefore) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Update user
        const updatedUser = await updateUser(id, { name, role });

        // Log activity
        await logActivity({
            userId: session.user.id,
            action: 'user_updated',
            entityType: 'user',
            entityId: id,
            details: {
                before: { name: userBefore.name, role: userBefore.role },
                after: { name: updatedUser.name, role: updatedUser.role }
            },
            success: true
        });

        return NextResponse.json({ success: true, user: updatedUser });
    } catch (error: any) {
        console.error('Error updating user:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const id = parseInt(params.id);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
        }

        // Prevent users from deleting themselves
        if (id === session.user.id) {
            return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
        }

        // Get user before deletion for logging
        const userBefore = await getUserById(id);
        if (!userBefore) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Delete user
        const deletedUser = await deleteUser(id);

        // Log activity
        await logActivity({
            userId: session.user.id,
            action: 'user_deleted',
            entityType: 'user',
            entityId: id,
            details: { email: deletedUser.email, name: deletedUser.name, role: deletedUser.role },
            success: true
        });

        return NextResponse.json({ success: true, message: 'User deleted successfully' });
    } catch (error: any) {
        console.error('Error deleting user:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
