import { getServerSession } from 'next-auth';
import { authOptions } from './config';
import { NextResponse } from 'next/server';

export async function requireAuth() {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        return null;
    }

    return session;
}

export async function requireAdmin() {
    const session = await requireAuth();

    if (!session || session.user.role !== 'admin') {
        return null;
    }

    return session;
}

export function unauthorizedResponse() {
    return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to perform this action' },
        { status: 401 }
    );
}

export function forbiddenResponse() {
    return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have permission to perform this action' },
        { status: 403 }
    );
}
