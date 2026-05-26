'use client';

import { useState, useEffect } from 'react';
import { InventoryStock, ComboAvailability } from '@/types/inventory';
import { Package, TrendingUp, AlertTriangle, Globe, RefreshCw, CheckCircle } from 'lucide-react';

interface SingleSkuInfo {
  sku: string;
  name: string;
  id?: number;
  low_stock_threshold?: number | null;
}

interface InventoryDashboardProps {
  inventory: InventoryStock; // Legacy field
  comboAvailability: ComboAvailability[];
  singleSkuList?: SingleSkuInfo[];
  // New fields (all 6 statuses)
  inWarehouseStock?: Record<string, number>;
  availableForPurchaseStock?: Record<string, number>;
  processingStock?: Record<string, number>;
  pendingConsultStock?: Record<string, number>;
  pendingReviewStock?: Record<string, number>;
  backOrderStock?: Record<string, number>;
  // Legacy fields (for backward compatibility)
  pendingStock?: Record<string, number>;
  loading: boolean;
}

export default function InventoryDashboard({
  inventory,
  comboAvailability,
  singleSkuList = [],
  // New fields
  inWarehouseStock = {},
  availableForPurchaseStock = {},
  processingStock = {},
  pendingConsultStock = {},
  pendingReviewStock = {},
  backOrderStock = {},
  // Legacy fields
  pendingStock = {},
  loading,
}: InventoryDashboardProps) {
  const [webhookStatus, setWebhookStatus] = useState<'active' | 'paused' | 'disabled' | 'unconfigured' | 'error' | null>(null);
  const [webhookDetails, setWebhookDetails] = useState<any>(null);

  useEffect(() => {
    fetch('/api/webhooks/status')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          if (data.configured) {
            setWebhookStatus(data.webhook.status);
            setWebhookDetails(data.webhook);
          } else {
            setWebhookStatus('unconfigured');
          }
        } else {
          setWebhookStatus('error');
        }
      })
      .catch(() => {
        setWebhookStatus('error');
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Calculate low stock summary
  const lowStockSingleSkus = singleSkuList.filter((sku) => {
    const availableForPurchase = availableForPurchaseStock[sku.sku] ?? 0;
    const threshold = sku.low_stock_threshold ?? null;
    const isOutOfStock = availableForPurchase === 0;
    const isLowStock = !isOutOfStock && threshold !== null && availableForPurchase <= threshold;
    return isOutOfStock || isLowStock;
  });

  const lowStockComboSkus = comboAvailability.filter((combo) => {
    const threshold = combo.low_stock_threshold ?? null;
    const isOutOfStock = combo.maxAvailable === 0;
    const isLowStock = !isOutOfStock && threshold !== null && combo.maxAvailable <= threshold;
    return isOutOfStock || isLowStock;
  });

  const outOfStockSingle = lowStockSingleSkus.filter((sku) => {
    const availableForPurchase = availableForPurchaseStock[sku.sku] ?? 0;
    return availableForPurchase === 0;
  });

  const lowStockSingle = lowStockSingleSkus.filter((sku) => {
    const availableForPurchase = availableForPurchaseStock[sku.sku] ?? 0;
    return availableForPurchase > 0;
  });

  const outOfStockCombo = lowStockComboSkus.filter((combo) => combo.maxAvailable === 0);
  const lowStockCombo = lowStockComboSkus.filter((combo) => combo.maxAvailable > 0);

  const totalLowStockCount = lowStockSingleSkus.length + lowStockComboSkus.length;

  return (
    <div className="space-y-8">
      {/* WooCommerce Webhook Diagnostic Banner */}
      {webhookStatus && webhookStatus !== 'active' && (
        <div className={`border-2 rounded-xl p-5 shadow-sm animate-in fade-in slide-in-from-top-4 ${
          webhookStatus === 'disabled' || webhookStatus === 'paused'
            ? 'bg-red-50 border-red-200 text-red-900'
            : webhookStatus === 'unconfigured'
            ? 'bg-amber-50 border-amber-200 text-amber-900'
            : 'bg-gray-50 border-gray-200 text-gray-800'
        }`}>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 mt-0.5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                webhookStatus === 'disabled' || webhookStatus === 'paused'
                  ? 'bg-red-100 text-red-600'
                  : webhookStatus === 'unconfigured'
                  ? 'bg-amber-100 text-amber-600'
                  : 'bg-gray-200 text-gray-600'
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
            </div>
            <div className="flex-1">
              <h4 className="text-md font-bold mb-1">
                {webhookStatus === 'disabled' || webhookStatus === 'paused'
                  ? '🔴 WooCommerce Webhook Disconnected!'
                  : webhookStatus === 'unconfigured'
                  ? '⚠️ WooCommerce Webhook Unconfigured'
                  : '⚠️ Webhook Connection Error'}
              </h4>
              <p className="text-sm opacity-90 leading-relaxed mb-3">
                {webhookStatus === 'disabled' || webhookStatus === 'paused'
                  ? `WooCommerce has disabled or paused order syncing for your store. Real-time sales and stock changes are currently OFFLINE. (Webhook ID: ${webhookDetails?.id || 'Unknown'})`
                  : webhookStatus === 'unconfigured'
                  ? 'No WooCommerce webhook topic "order.updated" was detected pointing to your Vercel domains. Live order stock syncing will not operate.'
                  : 'Could not fetch live webhook connection status from WooCommerce.'}
              </p>
              <div className="flex flex-wrap gap-3">
                <a 
                  href="https://forhimclinic.com/wp-admin/admin.php?page=wc-settings&tab=advanced&section=webhooks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-colors ${
                    webhookStatus === 'disabled' || webhookStatus === 'paused'
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-amber-600 hover:bg-amber-700 text-white'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  Open WooCommerce Settings
                </a>
                <button 
                  onClick={() => {
                    setWebhookStatus(null);
                    fetch('/api/webhooks/status')
                      .then(res => res.json())
                      .then(data => {
                        if (data.success && data.configured) {
                          setWebhookStatus(data.webhook.status);
                          setWebhookDetails(data.webhook);
                        } else if (data.success) {
                          setWebhookStatus('unconfigured');
                        } else {
                          setWebhookStatus('error');
                        }
                      });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Re-Check Status
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {webhookStatus === 'active' && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
              <CheckCircle className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-semibold text-emerald-950">WooCommerce Webhook Online</span>
              <p className="text-xs text-emerald-700 mt-0.5">
                Order status updates and inventory syncing are functioning in real-time.
              </p>
            </div>
          </div>
          <div className="text-xs font-medium text-emerald-700 bg-emerald-100/50 px-2.5 py-1 rounded-full border border-emerald-200 whitespace-nowrap self-start sm:self-auto">
            Active: {webhookDetails?.delivery_url ? new URL(webhookDetails.delivery_url).hostname : 'Vercel'}
          </div>
        </div>
      )}
      {/* Low Stock Summary Header */}
      {totalLowStockCount > 0 && (
        <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-lg p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-900 mb-3">
                Low Stock Alert
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Single SKUs Summary */}
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Single SKUs
                  </h4>
                  {outOfStockSingle.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs font-medium text-red-600 mb-1">
                        Out of Stock ({outOfStockSingle.length}):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {outOfStockSingle.map((sku) => (
                          <span
                            key={sku.sku}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200"
                          >
                            {sku.sku}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {lowStockSingle.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-yellow-600 mb-1">
                        Low Stock ({lowStockSingle.length}):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {lowStockSingle.map((sku) => {
                          const available = availableForPurchaseStock[sku.sku] ?? 0;
                          const threshold = sku.low_stock_threshold ?? null;
                          return (
                            <span
                              key={sku.sku}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200"
                              title={`Available: ${available} (Threshold: ${threshold ?? 'N/A'})`}
                            >
                              {sku.sku} ({available})
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {lowStockSingleSkus.length === 0 && (
                    <div className="text-xs text-gray-500">No low stock items</div>
                  )}
                </div>

                {/* Combo SKUs Summary */}
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Combo SKUs
                  </h4>
                  {outOfStockCombo.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs font-medium text-red-600 mb-1">
                        Out of Stock ({outOfStockCombo.length}):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {outOfStockCombo.map((combo) => (
                          <span
                            key={combo.sku}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200"
                          >
                            {combo.sku}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {lowStockCombo.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-yellow-600 mb-1">
                        Low Stock ({lowStockCombo.length}):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {lowStockCombo.map((combo) => {
                          const threshold = combo.low_stock_threshold ?? null;
                          return (
                            <span
                              key={combo.sku}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200"
                              title={`Available: ${combo.maxAvailable} (Threshold: ${threshold ?? 'N/A'})`}
                            >
                              {combo.sku} ({combo.maxAvailable})
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {lowStockComboSkus.length === 0 && (
                    <div className="text-xs text-gray-500">No low stock items</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Single SKUs Section */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Package className="w-5 h-5" />
          Single SKU Inventory
        </h2>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    In Warehouse
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Available for Purchase
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Processing
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pending Consult
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pending Review
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Back Order
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {singleSkuList.length > 0 ? (
                  singleSkuList.map((sku) => {
                    // Use new fields if available, otherwise fall back to legacy fields
                    const inWarehouse = inWarehouseStock[sku.sku] ?? inventory[sku.sku] ?? 0;
                    const availableForPurchase = availableForPurchaseStock[sku.sku] ?? 0;
                    const processing = processingStock[sku.sku] ?? 0;
                    const pendingConsult = pendingConsultStock[sku.sku] ?? 0;
                    const pendingReview = pendingReviewStock[sku.sku] ?? 0;
                    const backOrder = Math.abs(backOrderStock[sku.sku] || 0); // Display as positive
                    
                    // Use threshold from SKU Management (admin configurable)
                    // Red = No stock (available for purchase = 0)
                    // Yellow = Low stock (available for purchase > 0 && <= threshold)
                    // Green = Normal stock (available for purchase > threshold)
                    const threshold = sku.low_stock_threshold ?? null;
                    const isOutOfStock = availableForPurchase === 0;
                    const isLowStock = !isOutOfStock && threshold !== null && availableForPurchase <= threshold;
                    const hasBackOrder = backOrder > 0;

                    return (
                      <tr 
                        key={sku.sku} 
                        className={`hover:bg-gray-50 transition-colors ${
                          isOutOfStock && !hasBackOrder ? 'bg-red-50' : 
                          isOutOfStock && hasBackOrder ? 'bg-orange-50' :
                          isLowStock ? 'bg-yellow-50' : 
                          'bg-white'
                        }`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{sku.sku}</div>
                          {sku.name && (
                            <div className="text-xs text-gray-500 mt-0.5">{sku.name}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-semibold text-gray-900">
                            {inWarehouse}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-semibold ${
                            isOutOfStock ? 'text-red-600' : 
                            isLowStock ? 'text-yellow-600' : 
                            'text-green-600'
                          }`}>
                            {availableForPurchase}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-medium ${
                            processing > 0 ? 'text-blue-600' : 'text-gray-400'
                          }`}>
                            {processing > 0 ? processing : '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-medium ${
                            pendingConsult > 0 ? 'text-yellow-600' : 'text-gray-400'
                          }`}>
                            {pendingConsult > 0 ? pendingConsult : '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-medium ${
                            pendingReview > 0 ? 'text-yellow-600' : 'text-gray-400'
                          }`}>
                            {pendingReview > 0 ? pendingReview : '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-semibold ${
                            hasBackOrder ? 'text-orange-600' : 'text-gray-400'
                          }`}>
                            {hasBackOrder ? backOrder : '-'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500 text-sm">
                      No single SKUs found in database. Please configure SKUs first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Combo SKUs Section */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Combo SKU Availability
        </h2>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Available for Purchase
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Limiting Component
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {comboAvailability.length > 0 ? (
                  comboAvailability.map((combo) => {
                    // Use threshold from SKU Management (admin configurable)
                    // Red = No stock (maxAvailable = 0)
                    // Yellow = Low stock (maxAvailable > 0 && <= threshold)
                    // Green = Normal stock (maxAvailable > threshold)
                    const threshold = combo.low_stock_threshold ?? null;
                    const isOutOfStock = combo.maxAvailable === 0;
                    const isLowStock = !isOutOfStock && threshold !== null && combo.maxAvailable <= threshold;

                    return (
                      <tr 
                        key={combo.sku} 
                        className={`hover:bg-gray-50 transition-colors ${
                          isOutOfStock ? 'bg-red-50' : 
                          isLowStock ? 'bg-yellow-50' : 
                          'bg-white'
                        }`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{combo.sku}</div>
                          {combo.name && (
                            <div className="text-xs text-gray-500 mt-0.5">{combo.name}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-semibold ${
                            isOutOfStock ? 'text-red-600' : 
                            isLowStock ? 'text-yellow-600' : 
                            'text-green-600'
                          }`}>
                            {combo.maxAvailable}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {combo.limitingComponent ? (
                            <div className="text-sm text-gray-700">
                              <span className="font-medium">{combo.limitingComponent}</span>
                              <span className="text-xs text-gray-400 ml-2">
                                ({availableForPurchaseStock[combo.limitingComponent] || 0} available)
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-gray-500 text-sm">
                      No combo SKUs found in database.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
