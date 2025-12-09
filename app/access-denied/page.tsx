'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AlertTriangle, ArrowLeft, Mail, Shield } from 'lucide-react';

function AccessDeniedContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const error = searchParams.get('error');

    return (
        <div className="min-h-screen bg-gradient-to-br from-red-900 via-gray-900 to-slate-900 flex items-center justify-center p-4">
            <div className="relative w-full max-w-md">
                {/* Decorative elements */}
                <div className="absolute -top-20 -left-20 w-64 h-64 bg-red-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
                <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-orange-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>

                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-8 relative z-10">
                    <div className="flex flex-col items-center text-center mb-8">
                        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-6 border-2 border-red-400/30">
                            <Shield className="text-red-400 w-8 h-8" />
                        </div>
                        <h1 className="text-3xl font-bold text-white mb-2">Access Denied</h1>
                        <p className="text-red-200 text-sm">You don't have permission to access this system</p>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-red-500/10 border border-red-400/30 rounded-lg p-4">
                            <div className="flex gap-3">
                                <AlertTriangle className="text-red-400 w-5 h-5 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <h3 className="text-white font-semibold mb-1">Authorization Required</h3>
                                    <p className="text-gray-300 text-sm">
                                        Your email address is not registered in the system. Only authorized HIM Clinic staff can access this inventory management system.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="bg-gray-500/10 border border-gray-400/30 rounded-lg p-3">
                                <p className="text-gray-300 text-xs">
                                    Error: {error === 'AccessDenied' ? 'Your account is not whitelisted' : error}
                                </p>
                            </div>
                        )}

                        <div className="bg-blue-500/10 border border-blue-400/30 rounded-lg p-4">
                            <div className="flex gap-3">
                                <Mail className="text-blue-400 w-5 h-5 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <h3 className="text-white font-semibold mb-1">Need Access?</h3>
                                    <p className="text-gray-300 text-sm mb-3">
                                        Contact your system administrator to request access to the inventory management system.
                                    </p>
                                    <p className="text-blue-300 text-xs font-mono">
                                        Provide them with your Google account email address for whitelisting.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => router.push('/')}
                            className="w-full group relative flex items-center justify-center gap-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Login
                        </button>

                        <div className="pt-4 border-t border-white/10">
                            <p className="text-center text-xs text-gray-400">
                                HIM Clinic - Inventory Management System
                            </p>
                            <p className="text-center text-xs text-gray-500 mt-1">
                                Authorized Personnel Only
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function AccessDeniedPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-red-900 via-gray-900 to-slate-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
            </div>
        }>
            <AccessDeniedContent />
        </Suspense>
    );
}

