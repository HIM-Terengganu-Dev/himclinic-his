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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Single SKUs Section */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Package className="w-5 h-5" />
          Single SKU Inventory
        </h2>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quantity
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {SINGLE_SKUS.map((sku) => {
                  const quantity = inventory[sku.sku] || 0;
                  const isLowStock = quantity < 5;
                  const isOutOfStock = quantity === 0;

                  return (
                    <tr key={sku.sku} className={`hover:bg-opacity-75 transition-colors ${isOutOfStock ? 'bg-red-50' : isLowStock ? 'bg-yellow-50' : 'bg-white'}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 border-r border-gray-100 last:border-0">
                        {sku.sku}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <span className={`font-bold ${isOutOfStock ? 'text-red-600' : isLowStock ? 'text-yellow-600' : 'text-green-600'}`}>
                          {quantity}
                        </span>
                        <span className="text-gray-500 ml-1 text-xs">units</span>
                      </td>
                    </tr>
                  );
                })}
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
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Available
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Limiting
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {comboAvailability.map((combo) => {
                  const isLowStock = combo.maxAvailable < 5;
                  const isOutOfStock = combo.maxAvailable === 0;

                  return (
                    <tr key={combo.sku} className={`hover:bg-opacity-75 transition-colors ${isOutOfStock ? 'bg-red-50' : isLowStock ? 'bg-yellow-50' : 'bg-white'}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 border-r border-gray-100 last:border-0">
                        {combo.sku}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <span className={`font-bold ${isOutOfStock ? 'text-red-600' : isLowStock ? 'text-yellow-600' : 'text-green-600'}`}>
                          {combo.maxAvailable}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {combo.limitingComponent} <span className="text-xs text-gray-400">({inventory[combo.limitingComponent] || 0})</span>
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




