'use client';

import { useEffect, useState, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Package, RefreshCw, AlertTriangle, Bell, TrendingUp, History, Settings, LogOut, User, CheckCircle, ArrowLeftCircle, Shield, FlaskConical } from 'lucide-react';
import InventoryDashboard from '@/components/InventoryDashboard';
import ProcurementUpdate from '@/components/ProcurementUpdate';
import ReturnRefund from '@/components/ReturnRefund';
import ActivityLog from '@/components/ActivityLog';
import SkuManagement from '@/components/SkuManagement';
import AdminAccess from '@/components/AdminAccess';
import LoginPage from '@/components/LoginPage';
import TestEnvironment from '@/components/TestEnvironment';
import { InventoryStock, ComboAvailability } from '@/types/inventory';

export default function Home() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'procurement' | 'return-refund' | 'activity' | 'admin' | 'sku' | 'test'>('dashboard');
  const [switchedRole, setSwitchedRole] = useState<string | null>(null);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement>(null);
  const [inventory, setInventory] = useState<InventoryStock>({});
  const [comboAvailability, setComboAvailability] = useState<ComboAvailability[]>([]);
  const [singleSkuList, setSingleSkuList] = useState<Array<{ sku: string; name: string; id?: number }>>([]);
  // New fields (all 6 statuses)
  const [inWarehouseStock, setInWarehouseStock] = useState<Record<string, number>>({});
  const [availableForPurchaseStock, setAvailableForPurchaseStock] = useState<Record<string, number>>({});
  const [processingStock, setProcessingStock] = useState<Record<string, number>>({});
  const [pendingConsultStock, setPendingConsultStock] = useState<Record<string, number>>({});
  const [pendingReviewStock, setPendingReviewStock] = useState<Record<string, number>>({});
  const [backOrderStock, setBackOrderStock] = useState<Record<string, number>>({});
  // Legacy fields (for backward compatibility)
  const [pendingStock, setPendingStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Removed: newOrdersCount - orders are read-only, no notifications needed
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [showRefreshNotification, setShowRefreshNotification] = useState(false);

  const fetchInventory = async (showNotification = false, showLoading = true) => {
    try {
      // Only show loading indicator for manual refreshes or initial load
      if (showLoading) {
        setLoading(true);
      }
      // Add cache-busting query parameter to ensure fresh data
      const response = await fetch(`/api/inventory?t=${Date.now()}`, {
        cache: 'no-store',
      });
      const data = await response.json();

      if (data.success) {
        // New fields (all 6 statuses)
        setInWarehouseStock(data.inWarehouseStock || {});
        setAvailableForPurchaseStock(data.availableForPurchaseStock || {});
        setProcessingStock(data.processingStock || {});
        setPendingConsultStock(data.pendingConsultStock || {});
        setPendingReviewStock(data.pendingReviewStock || {});
        setBackOrderStock(data.backOrderStock || {});
        // Legacy fields (for backward compatibility)
        setInventory(data.singleSkus || {});
        setPendingStock(data.pendingStock || {});
        setComboAvailability(data.comboAvailability || []);
        setSingleSkuList(data.singleSkuList || []);
        setLastUpdated(new Date());

        // Show notification if refresh was manually triggered
        if (showNotification) {
          setShowRefreshNotification(true);
          // Auto-hide notification after 3 seconds
          setTimeout(() => {
            setShowRefreshNotification(false);
          }, 3000);
        }

        // Note: Inventory is read from HIS database transactions
      }
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchInventory();
      
      // Auto-refresh every 30 seconds
      const interval = setInterval(() => {
        fetchInventory(false, false); // Silent refresh, no loading indicator
      }, 30000); // 30 seconds
      
      return () => clearInterval(interval);
    }
  }, [status]);



  const handleRefresh = () => {
    fetchInventory(true, true); // Show notification and loading indicator
  };


  const handleLogout = async () => {
    await signOut({ callbackUrl: '/' });
  };

  // Load switched role from sessionStorage on mount
  useEffect(() => {
    if (session?.user?.role === 'dev') {
      const stored = sessionStorage.getItem('switchedRole');
      if (stored && (stored === 'admin' || stored === 'dev' || stored === 'user')) {
        setSwitchedRole(stored);
      }
    } else {
      // Clear switched role if user is not dev
      setSwitchedRole(null);
      sessionStorage.removeItem('switchedRole');
    }
  }, [session]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (roleMenuRef.current && !roleMenuRef.current.contains(event.target as Node)) {
        setShowRoleMenu(false);
      }
    };

    if (showUserMenu || showRoleMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu, showRoleMenu]);

  // Get effective role (switched role for dev users, otherwise actual role)
  const effectiveRole = (session?.user?.role === 'dev' && switchedRole) ? switchedRole : session?.user?.role;
  const isAdmin = effectiveRole === 'admin';
  const isDev = effectiveRole === 'dev';
  const actualRole = session?.user?.role; // Keep track of actual role for dev users

  // No redirects needed - all authenticated users can access all tabs now

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  const totalSingleSkuStock = Object.values(inventory).reduce((sum, qty) => sum + qty, 0);
  const totalComboAvailable = comboAvailability.reduce((sum, combo) => sum + combo.maxAvailable, 0);
  const lowStockItems = Object.entries(inventory).filter(([_, qty]) => qty < 5).length;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#EEEEEE' }}>
      {/* Refresh Notification Toast */}
      {showRefreshNotification && (
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 animate-pulse">
          <div className="bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 border border-green-600">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">Data refreshed successfully!</span>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white shadow-md sticky top-0 z-50 backdrop-blur-md bg-white/90">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-cyan-500 rounded-lg flex items-center justify-center shadow-md">
                <Package className="text-white w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 leading-none">
                  HIM Clinic
                </h1>
                <p className="text-xs text-gray-500 mt-1 font-medium bg-gray-100 px-2 py-0.5 rounded-full inline-block">
                  Inventory System
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 mr-4 text-sm text-gray-600 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                Live Connection
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRefresh}
                  className="p-2 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 hover:text-blue-600 transition-colors shadow-sm"
                  disabled={loading}
                >
                  <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                </button>

                <div className="h-8 w-px bg-gray-200 mx-1"></div>

                {/* User Profile Dropdown */}
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 pl-1 hover:opacity-80 transition-opacity"
                  >
                    {session?.user?.image ? (
                      <img
                        src={session.user.image}
                        alt={session.user.name || 'User'}
                        className="w-9 h-9 rounded-full border-2 border-white shadow-sm cursor-pointer"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold cursor-pointer hover:bg-blue-200 transition-colors">
                        {session?.user?.name?.charAt(0) || 'U'}
                      </div>
                    )}
                  </button>

                  {/* Dropdown Menu */}
                  {showUserMenu && (
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                      {/* User Info */}
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm font-semibold text-gray-900">
                          {session?.user?.name || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {session?.user?.email}
                        </p>
                        {session?.user?.role && (
                          <div className="mt-2 relative">
                            {actualRole === 'dev' ? (
                              <div className="relative">
                                <button
                                  onClick={() => setShowRoleMenu(!showRoleMenu)}
                                  className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200 cursor-pointer transition-colors"
                                  title="Click to switch role"
                                >
                                  {effectiveRole === 'admin' ? 'Administrator' : effectiveRole === 'dev' ? 'Developer' : 'Staff'}
                                  {switchedRole && switchedRole !== actualRole && ' (switched)'}
                                </button>
                                {showRoleMenu && (
                                  <div className="absolute left-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                                    <button
                                      onClick={() => {
                                        setSwitchedRole('dev');
                                        sessionStorage.setItem('switchedRole', 'dev');
                                        setShowRoleMenu(false);
                                      }}
                                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${effectiveRole === 'dev' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
                                    >
                                      Developer
                                    </button>
                                    <button
                                      onClick={() => {
                                        setSwitchedRole('admin');
                                        sessionStorage.setItem('switchedRole', 'admin');
                                        setShowRoleMenu(false);
                                      }}
                                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${effectiveRole === 'admin' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
                                    >
                                      Administrator
                                    </button>
                                    <button
                                      onClick={() => {
                                        setSwitchedRole('user');
                                        sessionStorage.setItem('switchedRole', 'user');
                                        setShowRoleMenu(false);
                                      }}
                                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${effectiveRole === 'user' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
                                    >
                                      Staff
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                                {effectiveRole === 'admin' ? 'Administrator' : effectiveRole === 'dev' ? 'Developer' : 'Staff'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Logout Button */}
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">

        {/* Navigation Tabs */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-8">
          <div className="border-b border-gray-200 overflow-x-auto">
            <nav className="flex min-w-max">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all relative ${activeTab === 'dashboard'
                  ? 'text-blue-600 bg-blue-50/50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                <Package size={18} />
                Dashboard
                {activeTab === 'dashboard' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600" />}
              </button>

              {/* Procurement tab - visible to all authenticated users */}
              <button
                onClick={() => setActiveTab('procurement')}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all relative ${activeTab === 'procurement'
                  ? 'text-blue-600 bg-blue-50/50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                <TrendingUp size={18} />
                Procurement Stock Update
                {activeTab === 'procurement' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600" />}
              </button>

              {/* Return/Refund tab - visible to all authenticated users */}
              <button
                onClick={() => setActiveTab('return-refund')}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all relative ${activeTab === 'return-refund'
                  ? 'text-orange-600 bg-orange-50/50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                <ArrowLeftCircle size={18} />
                Refund/Return
                {activeTab === 'return-refund' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-orange-600" />}
              </button>

              {/* SKU Management tab - visible to all authenticated users */}
              <button
                onClick={() => setActiveTab('sku')}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all relative ${activeTab === 'sku'
                  ? 'text-purple-600 bg-purple-50/50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                <Settings size={18} />
                SKU Management
                {activeTab === 'sku' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-600" />}
              </button>

              <button
                onClick={() => setActiveTab('activity')}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all relative ${activeTab === 'activity'
                  ? 'text-blue-600 bg-blue-50/50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                <History size={18} />
                Activity Log
                {activeTab === 'activity' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600" />}
              </button>

              {(isAdmin || isDev) && (
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all relative ${activeTab === 'admin'
                    ? 'text-purple-600 bg-purple-50/50'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                >
                  <Shield size={18} />
                  Admin Access
                  {activeTab === 'admin' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-600" />}
                </button>
              )}

              {isDev && (
                <button
                  onClick={() => setActiveTab('test')}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all relative ${activeTab === 'test'
                    ? 'text-purple-600 bg-purple-50/50'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                >
                  <FlaskConical size={18} />
                  Test Environment
                  {activeTab === 'test' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-600" />}
                </button>
              )}

            </nav>
          </div>

          <div className="p-6 md:p-8 bg-gray-50/30 min-h-[500px]">
            {activeTab === 'dashboard' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-12">
                  <InventoryDashboard
                    inventory={inventory}
                    comboAvailability={comboAvailability}
                    singleSkuList={singleSkuList}
                    // New fields (all 6 statuses)
                    inWarehouseStock={inWarehouseStock}
                    availableForPurchaseStock={availableForPurchaseStock}
                    processingStock={processingStock}
                    pendingConsultStock={pendingConsultStock}
                    pendingReviewStock={pendingReviewStock}
                    backOrderStock={backOrderStock}
                    // Legacy fields
                    pendingStock={pendingStock}
                    loading={loading}
                  />
                </div>
              </div>
            )}

            {activeTab === 'procurement' && (
              <ProcurementUpdate onStockUpdated={fetchInventory} />
            )}

            {activeTab === 'return-refund' && (
              <ReturnRefund onStockUpdated={fetchInventory} />
            )}

            {activeTab === 'activity' && (
              <ActivityLog />
            )}

            {activeTab === 'admin' && (isAdmin || isDev) && (
              <AdminAccess />
            )}

            {activeTab === 'sku' && (
              <SkuManagement />
            )}

            {activeTab === 'test' && isDev && (
              <TestEnvironment />
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
