'use client';

import { useEffect, useState } from 'react';
import { Package, RefreshCw, AlertTriangle, Bell, TrendingUp } from 'lucide-react';
import InventoryDashboard from '@/components/InventoryDashboard';
import RecentOrders from '@/components/RecentOrders';
import ProcurementUpdate from '@/components/ProcurementUpdate';
import { InventoryStock, ComboAvailability, ProcessedOrder } from '@/types/inventory';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'procurement'>('dashboard');
  const [inventory, setInventory] = useState<InventoryStock>({});
  const [comboAvailability, setComboAvailability] = useState<ComboAvailability[]>([]);
  const [recentOrders, setRecentOrders] = useState<ProcessedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [newOrdersCount, setNewOrdersCount] = useState(0);

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

        // Show notification if new orders were processed
        if (data.newOrdersProcessed && data.newOrdersProcessed.length > 0) {
          setNewOrdersCount(data.newOrdersProcessed.length);
          
          // Clear notification after 5 seconds
          setTimeout(() => setNewOrdersCount(0), 5000);
        }
      }
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchInventory();
    }, 300000); // 5 minutes (300 seconds)

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleRefresh = () => {
    fetchInventory();
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  const totalSingleSkuStock = Object.values(inventory).reduce((sum, qty) => sum + qty, 0);
  const totalComboAvailable = comboAvailability.reduce((sum, combo) => sum + combo.maxAvailable, 0);
  const lowStockItems = Object.entries(inventory).filter(([_, qty]) => qty < 5).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Telehealth Inventory Management System
              </h1>
              <p className="text-sm text-gray-600 mt-1">ForHim Clinic - Automatic Stock Management</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleAutoRefresh}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  autoRefresh
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={handleRefresh}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* New Orders Notification */}
        {newOrdersCount > 0 && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
            <Bell className="w-5 h-5 text-green-600" />
            <p className="text-green-800 font-medium">
              🎉 {newOrdersCount} new order{newOrdersCount > 1 ? 's' : ''} processed automatically!
            </p>
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Single SKU Stock</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalSingleSkuStock}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Combo SKUs Available</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalComboAvailable}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <Package className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Low Stock Items</p>
                <p className="text-3xl font-bold text-red-600 mt-2">{lowStockItems}</p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </div>
        </div>

        {lastUpdated && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-600">
              Last updated: {lastUpdated.toLocaleTimeString()}
              {autoRefresh && <span className="ml-2 text-green-600">(Auto-checking for orders every 5 minutes)</span>}
            </p>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="bg-white rounded-lg shadow-md mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'dashboard'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Dashboard
                </div>
              </button>
              <button
                onClick={() => setActiveTab('procurement')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'procurement'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Procurement Update
                </div>
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'dashboard' ? (
              <div className="space-y-6">
                {/* Recently Processed Orders */}
                <RecentOrders orders={recentOrders} />

                {/* Inventory Dashboard */}
                <InventoryDashboard
                  inventory={inventory}
                  comboAvailability={comboAvailability}
                  loading={loading}
                />
              </div>
            ) : (
              <ProcurementUpdate onStockUpdated={fetchInventory} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
