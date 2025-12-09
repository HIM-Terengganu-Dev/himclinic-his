'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Pill, Activity, ShieldCheck, ArrowRight } from 'lucide-react';

export default function LoginPage() {
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async () => {
        setIsLoading(true);
        await signIn('google', { callbackUrl: '/' });
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
            <div className="relative w-full max-w-md">
                {/* Decorative elements */}
                <div className="absolute -top-20 -left-20 w-64 h-64 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
                <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>

                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-8 relative z-10">
                    <div className="flex flex-col items-center text-center mb-10">
                        <div className="w-16 h-16 bg-gradient-to-tr from-blue-500 to-cyan-400 rounded-2xl flex items-center justify-center shadow-lg mb-6 rotate-3 hover:rotate-6 transition-transform">
                            <Pill className="text-white w-8 h-8" />
                        </div>
                        <h1 className="text-3xl font-bold text-white mb-2">HIM Clinic</h1>
                        <p className="text-blue-200">Inventory Management System</p>
                    </div>

                    <div className="space-y-6">
                        <div className="space-y-4 text-sm text-gray-300">
                            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
                                <Activity className="text-blue-400 w-5 h-5 flex-shrink-0" />
                                <span>Real-time stock tracking</span>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
                                <ShieldCheck className="text-green-400 w-5 h-5 flex-shrink-0" />
                                <span>Secure automated processing</span>
                            </div>
                        </div>

                        <button
                            onClick={handleLogin}
                            disabled={isLoading}
                            className="w-full group relative flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-900 font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-xl hover:shadow-2xl disabled:opacity-70 disabled:cursor-not-allowed transform hover:-translate-y-0.5"
                        >
                            <img
                                src="https://www.google.com/favicon.ico"
                                alt="Google"
                                className="w-5 h-5"
                            />
                            {isLoading ? 'Connecting...' : 'Sign in with Google'}
                            {!isLoading && (
                                <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-gray-900 transition-colors" />
                            )}
                        </button>

                        <p className="text-center text-xs text-gray-400 mt-6">
                            Authorized personnel only. Contact admin for access.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
