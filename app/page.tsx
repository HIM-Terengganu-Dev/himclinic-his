'use client';

import { useEffect, useState, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Package, RefreshCw, AlertTriangle, Bell, TrendingUp, History, Settings, LogOut, User } from 'lucide-react';
import InventoryDashboard from '@/components/InventoryDashboard';
import RecentOrders from '@/components/RecentOrders';
import ProcurementUpdate from '@/components/ProcurementUpdate';
import ActivityLog from '@/components/ActivityLog';
import SkuManagement from '@/components/SkuManagement';
import LoginPage from '@/components/LoginPage';
import { InventoryStock, ComboAvailability, ProcessedOrder } from '@/types/inventory';

export default function Home() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'procurement' | 'activity' | 'sku'>('dashboard');
  const [inventory, setInventory] = useState<InventoryStock>({});
  const [comboAvailability, setComboAvailability] = useState<ComboAvailability[]>([]);
  const [recentOrders, setRecentOrders] = useState<ProcessedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  // Removed: newOrdersCount - orders are read-only, no notifications needed

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/inventory');
      const data = await response.json();

      if (data.success) {
        setInventory(data.singleSkus);
        setComboAvailability(data.comboAvailability);
        setRecentOrders(data.recentlyProcessedOrders || []);
        setLastUpdated(new Date());

        // Note: We don't show notifications for orders anymore
        // Orders are read-only from WooCommerce - we just track them locally
        // System only WRITES: manual stock updates and new products
      }
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchInventory();
    }
  }, [status]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!autoRefresh || status !== 'authenticated') return;

    const interval = setInterval(() => {
      fetchInventory();
    }, 300000); // 5 minutes (5 * 60 * 1000)

    return () => clearInterval(interval);
  }, [autoRefresh, status]);

  const handleRefresh = () => {
    fetchInventory();
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/' });
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

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
  const isAdmin = session?.user?.role === 'admin';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
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
                  onClick={toggleAutoRefresh}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${autoRefresh
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-gray-50 text-gray-600 border border-gray-200'
                    }`}
                >
                  <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin-slow' : ''}`} />
                  {autoRefresh ? 'Auto Is On' : 'Auto Is Off'}
                </button>

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
                          <span className="inline-block mt-2 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                            {session.user.role === 'admin' ? 'Administrator' : 'Staff'}
                          </span>
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
        {/* Orders are read-only from WooCommerce - no notifications */}

        {/* Top Stats Cards */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-center justify-between hover:shadow-md transition-shadow">
              <div>
                <p className="text-sm font-medium text-gray-500">Single SKU Stock</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{totalSingleSkuStock}</p>
              </div>
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-center justify-between hover:shadow-md transition-shadow">
              <div>
                <p className="text-sm font-medium text-gray-500">Combos Available</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{totalComboAvailable}</p>
              </div>
              <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-purple-600" />
              </div>
            </div>

            <div className={`rounded-xl shadow-sm border p-6 flex items-center justify-between transition-colors ${lowStockItems > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
              <div>
                <p className={`text-sm font-medium ${lowStockItems > 0 ? 'text-red-600' : 'text-gray-500'}`}>Low Stock Alerts</p>
                <p className={`text-3xl font-bold mt-1 ${lowStockItems > 0 ? 'text-red-700' : 'text-gray-900'}`}>{lowStockItems}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${lowStockItems > 0 ? 'bg-red-100' : 'bg-green-50'}`}>
                <AlertTriangle className={`w-6 h-6 ${lowStockItems > 0 ? 'text-red-600' : 'text-green-600'}`} />
              </div>
            </div>
          </div>
        )}

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

              {isAdmin && (
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
                    loading={loading}
                  />
                </div>
                <div className="lg:col-span-12">
                  <RecentOrders orders={recentOrders} />
                </div>
              </div>
            )}

            {activeTab === 'procurement' && (
              <ProcurementUpdate onStockUpdated={fetchInventory} />
            )}

            {activeTab === 'activity' && (
              <ActivityLog />
            )}

            {activeTab === 'sku' && isAdmin && (
              <SkuManagement />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
