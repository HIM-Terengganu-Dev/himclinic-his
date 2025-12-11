'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Download, Save } from 'lucide-react';
import { formatDateTimeGMT8 } from '@/lib/utils/date';

interface StockTakeItem {
  id: number;
  sku: string;
  sku_name: string;
  system_quantity: number;
  physical_quantity: number | null;
  variance: number | null;
  adjustment_applied: boolean;
}

interface StockTake {
  id: number;
  month: number;
  year: number;
  status: string;
  created_at: string;
  created_by_name: string;
  created_by_email: string;
}

interface StockTakeFormProps {
  stockTake: StockTake;
  items: StockTakeItem[];
  onComplete: () => void;
}

export default function StockTakeForm({ stockTake, items: initialItems, onComplete }: StockTakeFormProps) {
  const [items, setItems] = useState<StockTakeItem[]>(initialItems);
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<any>(null);

  // Initialize physical counts and remarks from existing items
  useEffect(() => {
    const counts: Record<string, number> = {};
    const remarksData: Record<string, string> = {};
    initialItems.forEach(item => {
      if (item.physical_quantity !== null) {
        counts[item.sku] = item.physical_quantity;
      }
      if (item.adjustment_notes) {
        remarksData[item.sku] = item.adjustment_notes;
      }
    });
    setPhysicalCounts(counts);
    setRemarks(remarksData);
  }, [initialItems]);

  const handlePhysicalCountChange = (sku: string, value: string) => {
    const numValue = value === '' ? 0 : parseInt(value);
    if (isNaN(numValue) || numValue < 0) return;

    setPhysicalCounts(prev => ({ ...prev, [sku]: numValue }));
    
    // Update items with calculated variance
    setItems(prev => prev.map(item => {
      if (item.sku === sku) {
        const systemQty = item.system_quantity;
        const variance = numValue - systemQty;
        return { ...item, physical_quantity: numValue, variance };
      }
      return item;
    }));
  };

  const calculateVariances = () => {
    setItems(prev => prev.map(item => {
      const physicalQty = physicalCounts[item.sku] || item.physical_quantity || 0;
      const variance = physicalQty - item.system_quantity;
      return { ...item, physical_quantity: physicalQty, variance };
    }));
  };

  const handleComplete = async () => {
    if (stockTake.status === 'completed') {
      setError('Stock take already completed');
      return;
    }

    // Validate that items with variance have remarks
    const itemsWithVariance = items.filter(item => {
      const physicalQty = physicalCounts[item.sku] ?? item.physical_quantity ?? 0;
      const variance = physicalQty - item.system_quantity;
      return variance !== 0;
    });

    const itemsWithoutRemarks = itemsWithVariance.filter(item => {
      const remark = remarks[item.sku]?.trim();
      return !remark || remark === '';
    });

    if (itemsWithoutRemarks.length > 0) {
      setError(`Please provide remarks for items with variance: ${itemsWithoutRemarks.map(i => i.sku).join(', ')}`);
      return;
    }

    setCompleting(true);
    setError(null);
    setSuccess(null);

    try {
      // Prepare physical counts array with remarks
      const counts = Object.entries(physicalCounts)
        .filter(([_, qty]) => qty !== undefined && qty !== null)
        .map(([sku, qty]) => ({ 
          sku, 
          physicalQuantity: qty,
          remarks: remarks[sku]?.trim() || null
        }));

      const response = await fetch(`/api/stock-take/${stockTake.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physicalCounts: counts }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(data);
        onComplete();
      } else {
        setError(data.error || 'Failed to complete stock take');
      }
    } catch (err) {
      setError('Network error. Please try again.');
      console.error('Error completing stock take:', err);
    } finally {
      setCompleting(false);
    }
  };

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

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
    'July', 'August', 'September', 'October', 'November', 'December'];

  const itemsWithVariance = items.filter(i => i.variance !== 0 && i.variance !== null).length;
  const totalVariance = items.reduce((sum, item) => sum + (item.variance || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Stock Take - {monthNames[stockTake.month - 1]} {stockTake.year}
        </h2>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>Created: {formatDateTimeGMT8(stockTake.created_at)}</span>
          <span>by {stockTake.created_by_name || stockTake.created_by_email}</span>
          {stockTake.status === 'completed' && (
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
              Completed
            </span>
          )}
        </div>
      </div>

      {stockTake.status === 'completed' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            This stock take has been completed. All adjustments have been applied to WooCommerce.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-600" />
            <p className="text-sm text-red-800 font-medium">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <h3 className="text-lg font-semibold text-green-900">Stock Take Completed Successfully!</h3>
          </div>
          <div className="space-y-2 text-sm text-green-800">
            <p><strong>Total Items:</strong> {success.summary?.totalItems || 0}</p>
            <p><strong>Items with Variance:</strong> {success.summary?.itemsWithVariance || 0}</p>
            <p><strong>Adjustments Applied:</strong> {success.summary?.adjustmentsApplied || 0}</p>
            {success.summary?.adjustmentsFailed > 0 && (
              <p className="text-red-700">
                <strong>Adjustments Failed:</strong> {success.summary.adjustmentsFailed}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <h3 className="font-semibold text-gray-900">Stock Count</h3>
              <span className="text-sm text-gray-600">
                {items.length} items • {itemsWithVariance} with variance
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            * Remarks are required for items with variance (when physical count doesn't match system count)
          </p>
          {stockTake.status !== 'completed' && (
            <button
              onClick={calculateVariances}
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Recalculate Variances
            </button>
          )}
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
                <th className="px-4 py-3">Remarks <span className="text-red-500">*</span></th>
                <th className="px-4 py-3 text-center">Status</th>
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
                  <td className="px-4 py-3 text-right">
                    {stockTake.status === 'completed' ? (
                      <span className="font-medium text-gray-900">
                        {item.physical_quantity ?? '—'}
                      </span>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        value={physicalCounts[item.sku] ?? item.physical_quantity ?? ''}
                        onChange={(e) => handlePhysicalCountChange(item.sku, e.target.value)}
                        className="w-24 px-2 py-1 border border-gray-300 rounded text-right focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="0"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getVarianceColor(item.variance)}`}>
                      {getVarianceLabel(item.variance)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {stockTake.status === 'completed' ? (
                      <span className="text-sm text-gray-600">
                        {item.adjustment_notes || '—'}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={remarks[item.sku] || ''}
                        onChange={(e) => setRemarks(prev => ({ ...prev, [item.sku]: e.target.value }))}
                        placeholder={item.variance !== 0 && item.variance !== null ? "Required for variance" : "Optional"}
                        className={`w-full px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          item.variance !== 0 && item.variance !== null && (!remarks[item.sku] || remarks[item.sku].trim() === '')
                            ? 'border-red-300 bg-red-50'
                            : 'border-gray-300'
                        }`}
                        required={item.variance !== 0 && item.variance !== null}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.adjustment_applied ? (
                      <CheckCircle className="w-5 h-5 text-green-600 mx-auto" />
                    ) : item.variance !== 0 && item.variance !== null ? (
                      <AlertTriangle className="w-5 h-5 text-yellow-600 mx-auto" />
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {stockTake.status !== 'completed' && (
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={handleComplete}
            disabled={completing}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {completing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Applying Adjustments...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Apply Adjustments & Complete
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

