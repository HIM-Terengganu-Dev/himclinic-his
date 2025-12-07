'use client';

import { InventoryStock, ComboAvailability } from '@/types/inventory';
import { SINGLE_SKUS } from '@/lib/data/single-skus';
import { AlertTriangle, Package, TrendingUp } from 'lucide-react';

interface InventoryDashboardProps {
  inventory: InventoryStock;
  comboAvailability: ComboAvailability[];
  loading: boolean;
}

export default function InventoryDashboard({
  inventory,
  comboAvailability,
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
    <div className="space-y-6">
      {/* Single SKUs Section */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Package className="w-5 h-5" />
          Single SKU Inventory
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SINGLE_SKUS.map((sku) => {
            const quantity = inventory[sku.sku] || 0;
            const isLowStock = quantity < 5;
            const isOutOfStock = quantity === 0;

            return (
              <div
                key={sku.sku}
                className={`border rounded-lg p-4 transition-colors ${
                  isOutOfStock
                    ? 'border-red-300 bg-red-50'
                    : isLowStock
                    ? 'border-yellow-300 bg-yellow-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 text-sm">{sku.name}</h3>
                    <p className="text-xs text-gray-500 mt-1">SKU: {sku.sku}</p>
                  </div>
                  {(isLowStock || isOutOfStock) && (
                    <AlertTriangle className={`w-5 h-5 ${isOutOfStock ? 'text-red-600' : 'text-yellow-600'}`} />
                  )}
                </div>
                <div className="mt-3">
                  <p className="text-2xl font-bold text-gray-900">{quantity}</p>
                  <p className="text-xs text-gray-600">units available</p>
                </div>
                {isOutOfStock && (
                  <div className="mt-2 text-xs text-red-600 font-medium">OUT OF STOCK</div>
                )}
                {isLowStock && !isOutOfStock && (
                  <div className="mt-2 text-xs text-yellow-600 font-medium">LOW STOCK</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Combo SKUs Section */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Combo SKU Availability
        </h2>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Max Available
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Limiting Component
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {comboAvailability.map((combo) => {
                  const isLowStock = combo.maxAvailable < 5;
                  const isOutOfStock = combo.maxAvailable === 0;

                  return (
                    <tr key={combo.sku} className={isOutOfStock ? 'bg-red-50' : isLowStock ? 'bg-yellow-50' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {combo.sku}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{combo.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`font-bold ${isOutOfStock ? 'text-red-600' : isLowStock ? 'text-yellow-600' : 'text-green-600'}`}>
                          {combo.maxAvailable}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {combo.limitingComponent} ({inventory[combo.limitingComponent] || 0} units)
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isOutOfStock ? (
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                            Out of Stock
                          </span>
                        ) : isLowStock ? (
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                            Low Stock
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                            In Stock
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}



