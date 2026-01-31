'use client';

import { InventoryStock, ComboAvailability } from '@/types/inventory';
import { Package, TrendingUp } from 'lucide-react';

interface SingleSkuInfo {
  sku: string;
  name: string;
  id?: number;
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
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
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
                    
                    const isLowStock = availableForPurchase < 5 && availableForPurchase > 0;
                    const isOutOfStock = availableForPurchase === 0;
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
                    const isLowStock = combo.maxAvailable < 5 && combo.maxAvailable > 0;
                    const isOutOfStock = combo.maxAvailable === 0;

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
                                ({inventory[combo.limitingComponent] || 0} available)
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
