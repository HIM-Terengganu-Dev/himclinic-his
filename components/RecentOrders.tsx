'use client';

import { ProcessedOrder } from '@/types/inventory';
import { Package, Clock } from 'lucide-react';
import { formatDistanceToNowGMT8 } from '@/lib/utils/date';

interface RecentOrdersProps {
  orders: ProcessedOrder[];
}

export default function RecentOrders({ orders }: RecentOrdersProps) {
  if (orders.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-md p-4 h-full">
        <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Package className="w-4 h-4" />
          Recently Processed Orders
        </h3>
        <p className="text-xs text-gray-500 text-center py-8">
          No orders processed yet. Orders will automatically appear here when they're processed.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md p-4 h-full flex flex-col">
      <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <Package className="w-4 h-4" />
        Recently Processed Orders ({orders.length})
      </h3>
      
      {/* Scrollable container with fixed height */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-2" style={{ maxHeight: '400px' }}>
        {orders.map((order) => (
          <div
            key={order.orderId}
            className="border border-gray-200 rounded-lg p-3 hover:border-blue-300 transition-colors bg-white"
          >
            {/* Order Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-gray-900 text-sm truncate">
                  Order #{order.orderId}
                </h4>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNowGMT8(order.processedAt, { addSuffix: true })}
                  </span>
                </div>
              </div>
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full whitespace-nowrap ml-2">
                Processed
              </span>
            </div>

            {/* Order Items */}
            <div className="space-y-1 mb-2">
              {order.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs bg-gray-50 p-1.5 rounded">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-900">{item.quantity}×</span>
                    <span className="text-gray-700 ml-1 truncate">{item.name}</span>
                  </div>
                  <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">{item.sku}</span>
                </div>
              ))}
            </div>

            {/* Stock Deductions */}
            <div className="border-t border-gray-200 pt-2">
              <p className="text-xs font-medium text-gray-600 mb-1">Stock Deducted:</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(order.totalDeductions).map(([sku, qty]) => (
                  <span
                    key={sku}
                    className="inline-flex items-center px-1.5 py-0.5 bg-red-50 text-red-700 text-xs font-medium rounded"
                  >
                    {sku}: -{qty}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}



