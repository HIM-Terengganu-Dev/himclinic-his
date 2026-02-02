'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Settings, Shield, Users, Database, Key, Box, Layers, Bell } from 'lucide-react';
import UserManagement from './UserManagement';
import SkuManagement from './SkuManagement';
import LowStockAlerts from './LowStockAlerts';

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

  const [activeSection, setActiveSection] = useState<'users' | 'skus' | 'low-stock'>('users');

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

        {/* Section Tabs */}
        <div className="flex bg-gray-100 rounded-lg p-1 mb-6">
          <button
            onClick={() => setActiveSection('users')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeSection === 'users' 
                ? 'bg-white shadow-sm text-purple-600' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Users size={16} />
            User Management
          </button>
          <button
            onClick={() => setActiveSection('skus')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeSection === 'skus' 
                ? 'bg-white shadow-sm text-purple-600' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Box size={16} />
            SKU Management
          </button>
          <button
            onClick={() => setActiveSection('low-stock')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeSection === 'low-stock' 
                ? 'bg-white shadow-sm text-purple-600' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Bell size={16} />
            Low Stock Alerts
          </button>
        </div>

        {/* Section Content */}
        {activeSection === 'users' && <UserManagement />}
        {activeSection === 'skus' && <SkuManagement />}
        {activeSection === 'low-stock' && <LowStockAlerts />}
      </div>
    </div>
  );
}

