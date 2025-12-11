'use client';

import { format } from 'date-fns';
import { formatDateTimeGMT8 } from '@/lib/utils/date';
import { Download, CheckCircle, AlertTriangle } from 'lucide-react';

interface StockTakeItem {
  id: number;
  sku: string;
  sku_name: string;
  system_quantity: number;
  physical_quantity: number | null;
  variance: number | null;
  adjustment_applied: boolean;
  adjustment_notes: string | null;
}

interface StockTake {
  id: number;
  month: number;
  year: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  created_by_name: string;
  created_by_email: string;
  completed_by_name: string | null;
  completed_by_email: string | null;
}

interface StockTakeReportProps {
  stockTake: StockTake;
  items: StockTakeItem[];
}

export default function StockTakeReport({ stockTake, items }: StockTakeReportProps) {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
    'July', 'August', 'September', 'October', 'November', 'December'];

  const handleExport = () => {
    const headers = ['SKU', 'Name', 'System Quantity', 'Physical Quantity', 'Variance', 'Adjustment Applied', 'Notes'];
    const csvContent = [
      headers.join(','),
      ...items.map(item => [
        `"${item.sku}"`,
        `"${item.sku_name}"`,
        item.system_quantity,
        item.physical_quantity ?? '',
        item.variance ?? '',
        item.adjustment_applied ? 'Yes' : 'No',
        `"${item.adjustment_notes || ''}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-take-${stockTake.month}-${stockTake.year}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const itemsWithVariance = items.filter(i => i.variance !== 0 && i.variance !== null).length;
  const itemsAdjusted = items.filter(i => i.adjustment_applied).length;
  const totalVariance = items.reduce((sum, item) => sum + (item.variance || 0), 0);

  const getVarianceColor = (variance: number | null) => {
    if (variance === null || variance === 0) return 'text-green-600 bg-green-50';
    if (Math.abs(variance) <= 5) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getVarianceLabel = (variance: number | null) => {
    if (variance === null) return '—';
    if (variance === 0) return '0';
    return variance > 0 ? `+${variance}` : `${variance}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Stock Take Report - {monthNames[stockTake.month - 1]} {stockTake.year}
          </h2>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            <div>
              <span className="font-medium">Created:</span>{' '}
              {formatDateTimeGMT8(stockTake.created_at)} by{' '}
              {stockTake.created_by_name || stockTake.created_by_email}
            </div>
            {stockTake.completed_at && (
              <div>
                <span className="font-medium">Completed:</span>{' '}
                {formatDateTimeGMT8(stockTake.completed_at)}
                {stockTake.completed_by_name && ` by ${stockTake.completed_by_name}`}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          <Download size={16} />
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">Total Items</p>
          <p className="text-2xl font-bold text-gray-900">{items.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">With Variance</p>
          <p className="text-2xl font-bold text-yellow-600">{itemsWithVariance}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">Adjustments Applied</p>
          <p className="text-2xl font-bold text-green-600">{itemsAdjusted}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">Total Variance</p>
          <p className={`text-2xl font-bold ${totalVariance === 0 ? 'text-gray-900' : totalVariance > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {totalVariance > 0 ? '+' : ''}{totalVariance}
          </p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900">Stock Count Details</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">System Qty</th>
                <th className="px-4 py-3 text-right">Physical Qty</th>
                <th className="px-4 py-3 text-right">Variance</th>
                <th className="px-4 py-3 text-center">Adjustment</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-medium text-gray-900">
                    {item.sku}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{item.sku_name}</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {item.system_quantity}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {item.physical_quantity ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getVarianceColor(item.variance)}`}>
                      {getVarianceLabel(item.variance)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.adjustment_applied ? (
                      <div className="flex items-center justify-center gap-1 text-green-600">
                        <CheckCircle size={16} />
                        <span className="text-xs">Applied</span>
                      </div>
                    ) : item.variance !== 0 && item.variance !== null ? (
                      <div className="flex items-center justify-center gap-1 text-yellow-600">
                        <AlertTriangle size={16} />
                        <span className="text-xs">Pending</span>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {item.adjustment_notes || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

