'use client';

import { useEffect, useState, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Package, RefreshCw, AlertTriangle, Bell, TrendingUp, History, Settings, LogOut, User, ClipboardCheck } from 'lucide-react';
import InventoryDashboard from '@/components/InventoryDashboard';
import ProcurementUpdate from '@/components/ProcurementUpdate';
import ActivityLog from '@/components/ActivityLog';
import SkuManagement from '@/components/SkuManagement';
import LoginPage from '@/components/LoginPage';
import { InventoryStock, ComboAvailability } from '@/types/inventory';

export default function Home() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'procurement' | 'activity' | 'sku'>('dashboard');
  const [inventory, setInventory] = useState<InventoryStock>({});
  const [comboAvailability, setComboAvailability] = useState<ComboAvailability[]>([]);
  const [singleSkuList, setSingleSkuList] = useState<Array<{ sku: string; name: string; id?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  // Removed: newOrdersCount - orders are read-only, no notifications needed
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [stockTakeData, setStockTakeData] = useState<any>(null);
  const [stockTakeLoading, setStockTakeLoading] = useState(false);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/inventory');
      const data = await response.json();

      if (data.success) {
        setInventory(data.singleSkus);
        setComboAvailability(data.comboAvailability);
        setSingleSkuList(data.singleSkuList || []);
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
      fetchCurrentStockTake();
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

  const fetchCurrentStockTake = async () => {
    try {
      setStockTakeLoading(true);
      const response = await fetch('/api/stock-take/current');
      const data = await response.json();
      if (data.success) {
        setStockTakeData(data);
      }
    } catch (error) {
      console.error('Error fetching current stock take:', error);
    } finally {
      setStockTakeLoading(false);
    }
  };

  const handleStockTakeClick = () => {
    // Navigate to stock take page
    window.location.href = '/stock-take';
  };

  const handleStockTakeComplete = () => {
    fetchCurrentStockTake();
    fetchInventory();
  };

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Single SKU Availability Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Package className="w-5 h-5 text-blue-600" />
                  Single SKU Availability
                </h3>
                <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                  {Object.keys(inventory).length} Items
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {/* No Stock (Includes Oversold) */}
                <div className="bg-red-50 rounded-lg p-3 border border-red-100">
                  <p className="text-xs font-medium text-red-600 uppercase tracking-wide">No Stock</p>
                  <p className="text-2xl font-bold text-red-700 mt-1">
                    {Object.values(inventory).filter(q => q <= 0).length}
                  </p>
                  <div className="mt-1 max-h-16 overflow-y-auto custom-scrollbar">
                    <p className="text-[10px] text-red-600 leading-tight">
                      {Object.entries(inventory).filter(([_, q]) => q <= 0).map(([sku]) => sku).join(', ') || 'None'}
                    </p>
                  </div>
                </div>

                {/* Low Stock */}
                <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-100">
                  <p className="text-xs font-medium text-yellow-600 uppercase tracking-wide">Low Stock</p>
                  <p className="text-2xl font-bold text-yellow-700 mt-1">
                    {Object.values(inventory).filter(q => q > 0 && q <= 10).length}
                  </p>
                  <div className="mt-1 max-h-16 overflow-y-auto custom-scrollbar">
                    <p className="text-[10px] text-yellow-600 leading-tight">
                      {Object.entries(inventory).filter(([_, q]) => q > 0 && q <= 10).map(([sku]) => sku).join(', ') || 'None'}
                    </p>
                  </div>
                </div>

                {/* Adequate */}
                <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                  <p className="text-xs font-medium text-green-600 uppercase tracking-wide">Adequate</p>
                  <p className="text-2xl font-bold text-green-700 mt-1">
                    {Object.values(inventory).filter(q => q > 10).length}
                  </p>
                </div>
              </div>
            </div>

            {/* Combo SKU Availability Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-purple-600" />
                  Combo SKU Availability
                </h3>
                <span className="text-xs font-medium bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full">
                  {comboAvailability.length} Items
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {/* No Stock (Includes Oversold) */}
                <div className="bg-red-50 rounded-lg p-3 border border-red-100">
                  <p className="text-xs font-medium text-red-600 uppercase tracking-wide">No Stock</p>
                  <p className="text-2xl font-bold text-red-700 mt-1">
                    {comboAvailability.filter(c => c.maxAvailable <= 0).length}
                  </p>
                  <div className="mt-1 max-h-16 overflow-y-auto custom-scrollbar">
                    <p className="text-[10px] text-red-600 leading-tight">
                      {comboAvailability.filter(c => c.maxAvailable <= 0).map(c => c.sku).join(', ') || 'None'}
                    </p>
                  </div>
                </div>

                {/* Low Stock */}
                <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-100">
                  <p className="text-xs font-medium text-yellow-600 uppercase tracking-wide">Low Stock</p>
                  <p className="text-2xl font-bold text-yellow-700 mt-1">
                    {comboAvailability.filter(c => c.maxAvailable > 0 && c.maxAvailable <= 10).length}
                  </p>
                  <div className="mt-1 max-h-16 overflow-y-auto custom-scrollbar">
                    <p className="text-[10px] text-yellow-600 leading-tight">
                      {comboAvailability.filter(c => c.maxAvailable > 0 && c.maxAvailable <= 10).map(c => c.sku).join(', ') || 'None'}
                    </p>
                  </div>
                </div>

                {/* Adequate */}
                <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                  <p className="text-xs font-medium text-green-600 uppercase tracking-wide">Adequate</p>
                  <p className="text-2xl font-bold text-green-700 mt-1">
                    {comboAvailability.filter(c => c.maxAvailable > 10).length}
                  </p>
                </div>
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

              {/* SKU Management tab hidden from UI but backend code remains */}
              {/* {isAdmin && (
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
              )} */}

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

              {/* Stock Take Button - Far Right, Separate from Tabs */}
              <div className="ml-auto flex items-center px-4">
                <button
                  onClick={handleStockTakeClick}
                  disabled={stockTakeLoading}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  <ClipboardCheck size={18} />
                  Stock Take
                </button>
              </div>
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
