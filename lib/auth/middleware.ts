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

export async function requireDev() {
    const session = await requireAuth();

    if (!session || session.user.role !== 'dev') {
        return null;
    }

    return session;
}

/**
 * Get the effective role for a request
 * If user is dev and has switched role in header, use that role
 * Otherwise, use the actual role from session
 */
export function getEffectiveRole(session: any, request?: Request): string {
    if (!session?.user) {
        return '';
    }

    // If user is dev, check for switched role in header
    if (session.user.role === 'dev' && request) {
        const switchedRole = request.headers.get('x-switched-role');
        if (switchedRole && (switchedRole === 'admin' || switchedRole === 'dev' || switchedRole === 'user')) {
            return switchedRole;
        }
    }

    return session.user.role;
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
