import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';

// WHITELIST: Only these emails can access the system
// Add your team's emails here
const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS?.split(',').map(e => e.trim()) || [];

// ADMIN EMAILS: Users with admin privileges
const ADMIN_EMAILS = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim()) || [];

export const authOptions: NextAuthOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        }),
    ],
    callbacks: {
        async signIn({ user }) {
            const email = user.email;
            
            if (!email) {
                console.log('❌ Sign in denied: No email provided');
                return false;
            }

            // Check if email is in the whitelist
            const isAllowed = ALLOWED_EMAILS.includes(email);
            
            if (isAllowed) {
                console.log(`✅ Sign in allowed: ${email}`);
                return true;
            } else {
                console.log(`❌ Sign in denied: ${email} is not in the whitelist`);
                return false; // This will redirect to the error page
            }
        },
        async session({ session }) {
            if (session.user?.email) {
                // Determine user role based on email
                const isAdmin = ADMIN_EMAILS.includes(session.user.email);
                session.user.role = isAdmin ? 'admin' : 'staff';
            }
            return session;
        },
    },
    pages: {
        signIn: '/', // Redirect to home (will show LoginPage if not authenticated)
        error: '/auth/error', // NextAuth error page
    },
    secret: process.env.NEXTAUTH_SECRET,
};

// Extend NextAuth types to include role and id
declare module 'next-auth' {
    interface Session {
        user: {
            id: number;
            role: string;
            name?: string | null;
            email?: string | null;
            image?: string | null;
        }
    }
}
