'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Settings, Shield, Users, Database, Key } from 'lucide-react';

export default function AdminAccess() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Access Denied</h2>
        <p className="text-gray-500">You need administrator privileges to access this section.</p>
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Placeholder for future admin features */}
          <div className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 hover:shadow-md transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-purple-600" />
              </div>
              <h3 className="font-semibold text-gray-900">User Management</h3>
            </div>
            <p className="text-sm text-gray-500">Manage system users and permissions</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 hover:shadow-md transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Database className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Database Tools</h3>
            </div>
            <p className="text-sm text-gray-500">Database administration and maintenance</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 hover:shadow-md transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Key className="w-5 h-5 text-green-600" />
              </div>
              <h3 className="font-semibold text-gray-900">System Settings</h3>
            </div>
            <p className="text-sm text-gray-500">Configure system parameters and preferences</p>
          </div>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600">
            <strong>Note:</strong> This section is reserved for administrative functions. Additional features will be added here as needed.
          </p>
        </div>
      </div>
    </div>
  );
}

