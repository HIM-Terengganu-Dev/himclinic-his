'use client';

import { ProcessedOrder } from '@/types/inventory';
import { Package, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface RecentOrdersProps {
  orders: ProcessedOrder[];
}

export default function RecentOrders({ orders }: RecentOrdersProps) {
  if (orders.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Package className="w-5 h-5" />
          Recently Processed Orders
        </h3>
        <p className="text-sm text-gray-500 text-center py-8">
          No orders processed yet. Orders will automatically appear here when they're processed.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Package className="w-5 h-5" />
        Recently Processed Orders ({orders.length})
      </h3>
      
      <div className="space-y-4">
        {orders.map((order) => (
          <div
            key={order.orderId}
            className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
          >
            {/* Order Header */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="font-semibold text-gray-900">
                  Order #{order.orderId}
                </h4>
                <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Processed {formatDistanceToNow(new Date(order.processedAt), { addSuffix: true })}
                  </span>
                  <span>
                    Created: {new Date(order.orderDate).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                Processed
              </span>
            </div>

            {/* Order Items */}
            <div className="space-y-2 mb-3">
              {order.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm bg-gray-50 p-2 rounded">
                  <div>
                    <span className="font-medium text-gray-900">{item.quantity}×</span>
                    <span className="text-gray-700 ml-2">{item.name}</span>
                  </div>
                  <span className="text-xs text-gray-500">{item.sku}</span>
                </div>
              ))}
            </div>

            {/* Stock Deductions */}
            <div className="border-t border-gray-200 pt-3">
              <p className="text-xs font-medium text-gray-600 mb-2">Stock Deducted:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(order.totalDeductions).map(([sku, qty]) => (
                  <span
                    key={sku}
                    className="inline-flex items-center px-2 py-1 bg-red-50 text-red-700 text-xs font-medium rounded"
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

