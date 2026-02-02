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

export async function requireAdmin(request?: Request) {
    const session = await requireAuth();

    if (!session) {
        return null;
    }

    // Check effective role (handles role switching for dev users)
    const effectiveRole = getEffectiveRole(session, request);
    
    if (effectiveRole !== 'admin') {
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
 * Require admin or dev role
 * Allows both admin users and dev users (with or without role switching)
 */
export async function requireAdminOrDev(request?: Request) {
    const session = await requireAuth();

    if (!session) {
        return null;
    }

    // Check effective role (handles role switching for dev users)
    const effectiveRole = getEffectiveRole(session, request);
    
    // Allow admin or dev users
    if (effectiveRole !== 'admin' && effectiveRole !== 'dev' && session.user.role !== 'dev') {
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
