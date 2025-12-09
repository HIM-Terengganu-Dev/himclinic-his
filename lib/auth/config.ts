import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';
import { getUserByGoogleId, getUserByEmail, createUser, updateLastLogin } from '@/lib/db/queries';

export const authOptions: NextAuthOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        }),
    ],
    callbacks: {
        async signIn({ user, account }) {
            if (account?.provider === 'google') {
                const googleId = account.providerAccountId;
                const email = user.email!;

                if (!email) {
                    console.log('❌ Sign in denied: No email provided');
                    return false;
                }

                try {
                    // Check if user exists by Google ID
                    let dbUser = await getUserByGoogleId(googleId);

                    // If not, try by email (in case they previously signed up differently)
                    if (!dbUser) {
                        dbUser = await getUserByEmail(email);
                    }

                    // If user doesn't exist in database, deny access
                    if (!dbUser) {
                        console.log(`❌ Sign in denied: ${email} is not registered in the database`);
                        return false; // This will redirect to the error page
                    }

                    // Update last login timestamp
                    await updateLastLogin(dbUser.id);

                    console.log(`✅ Sign in allowed: ${email} (role: ${dbUser.role})`);
                    return true;
                } catch (error) {
                    console.error('Error during sign in:', error);
                    return false;
                }
            }
            return true;
        },
        async session({ session, token }) {
            if (session.user?.email) {
                // Fetch user from database to get role and ID
                try {
                    const dbUser = await getUserByEmail(session.user.email);
                    if (dbUser) {
                        session.user.id = dbUser.id;
                        session.user.role = dbUser.role; // 'admin' or 'user' from database
                        session.user.image = dbUser.picture || session.user.image;
                    }
                } catch (error) {
                    console.error('Error fetching user for session:', error);
                }
            }
            return session;
        },
        async jwt({ token, user, account }) {
            // Pass initial user data to token
            if (user) {
                token.id = user.id;
            }
            return token;
        }
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
