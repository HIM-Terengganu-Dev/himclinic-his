'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Settings, Shield, Users, Database, Key } from 'lucide-react';
import UserManagement from './UserManagement';

export default function AdminAccess() {
  const { data: session } = useSession();
  const userRole = session?.user?.role;
  const isAdmin = userRole === 'admin';
  const isDev = userRole === 'dev';
  const hasAccess = isAdmin || isDev;

  if (!hasAccess) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Access Denied</h2>
        <p className="text-gray-500">You need administrator or developer privileges to access this section.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-tr from-purple-600 to-indigo-500 rounded-lg flex items-center justify-center">
            <Shield className="text-white w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Admin Access</h2>
            <p className="text-sm text-gray-500">Administrative tools and settings</p>
          </div>
        </div>

        <UserManagement />
      </div>
    </div>
  );
}

