'use client';

import { useState, useEffect } from 'react';
import { ArrowLeftCircle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { fetchWithRole } from '@/lib/utils/fetchWithRole';

interface SingleSku {
  id: number;
  sku: string;
  name: string;
  woocommerce_product_id: number;
}

interface ReturnRefundProps {
  onStockUpdated: () => void;
}

export default function ReturnRefund({ onStockUpdated }: ReturnRefundProps) {
  const [singleSkus, setSingleSkus] = useState<SingleSku[]>([]);
  const [loadingSkus, setLoadingSkus] = useState(false);

  const [selectedSku, setSelectedSku] = useState('');
  const [quantity, setQuantity] = useState('');
  const [condition, setCondition] = useState<'lost' | 'damaged' | 'good' | ''>('');
  const [notes, setNotes] = useState('');
  const [orderId, setOrderId] = useState('');

  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSingleSkus();
  }, []);

  const fetchSingleSkus = async () => {
    setLoadingSkus(true);
    try {
      const res = await fetchWithRole('/api/skus/single');
      if (!res.ok) {
        throw new Error(`Failed to fetch SKUs: ${res.status}`);
      }
      const data = await res.json();
      if (data.skus) {
        setSingleSkus(data.skus);
      } else if (data.error) {
        console.error('API error:', data.error);
        setError(data.error);
      }
    } catch (error) {
      console.error('Failed to fetch SKUs', error);
      setError('Failed to load SKU list. Please refresh the page.');
    } finally {
      setLoadingSkus(false);
    }
  };

  const handleReturn = async () => {
    if (!selectedSku || !quantity || !condition) {
      setError('Please select a SKU, enter quantity, and select condition');
      return;
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) {
      setError('Please enter a valid quantity (greater than 0)');
      return;
    }

    setUpdating(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetchWithRole('/api/refund-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: selectedSku,
          quantity: qty,
          condition,
          notes: notes.trim() || undefined,
          orderId: orderId.trim() || undefined
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
        onStockUpdated();
        setQuantity('');
        setNotes('');
        setOrderId('');
        setCondition('');
      } else {
        setError(data.error || 'Failed to process refund/return');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const getConditionColor = (cond: string) => {
    switch (cond) {
      case 'good': return 'text-green-600 bg-green-50 border-green-200';
      case 'damaged': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'lost': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getConditionLabel = (cond: string) => {
    switch (cond) {
      case 'good': return 'Good';
      case 'damaged': return 'Damaged';
      case 'lost': return 'Lost';
      default: return cond;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <ArrowLeftCircle className="w-5 h-5" />
          Refund/Return Processing
        </h2>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-orange-800">
            <strong>💡 Refund/Return Handling:</strong> Use this section to process refunded or returned items. 
            Staff must physically QC items first, then select the condition:
          </p>
          <ul className="text-sm text-orange-800 mt-2 ml-4 list-disc space-y-1">
            <li><strong>Good:</strong> Item is in good condition - Stock will be restored</li>
            <li><strong>Damaged:</strong> Item is damaged - Stock will NOT be restored (logged only)</li>
            <li><strong>Lost:</strong> Item is lost - Stock will NOT be restored (logged only)</li>
          </ul>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              <p className="text-sm text-red-800 font-medium">{error}</p>
            </div>
          </div>
        )}

        {/* Success Result */}
        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-6 h-6 text-green-600" />
              <h3 className="text-lg font-semibold text-green-900">Refund/Return Processed Successfully!</h3>
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-2">Refund/Return Details</h4>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-700">{result.sku}</span>
                  <span className="text-lg font-bold text-gray-900">{result.newLocalQuantity} units</span>
                </div>
                <div className="flex items-center gap-2 text-sm mb-2">
                  {result.stockRestored ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <span className="text-green-700">Stock restored successfully ✓</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-orange-600" />
                      <span className="text-orange-700">Stock not restored (condition: {getConditionLabel(result.condition)})</span>
                    </>
                  )}
                </div>
                <div className="mt-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getConditionColor(result.condition)}`}>
                    Condition: {getConditionLabel(result.condition)}
                  </span>
                </div>
              </div>

              {result.affectedComboSKUs && result.affectedComboSKUs.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">
                    Affected Combo SKUs
                  </h4>
                  <div className="space-y-2">
                    {result.affectedComboSKUs.map((combo: any) => (
                      <div key={combo.sku} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{combo.sku}</p>
                          <p className="text-xs text-gray-500">{combo.name}</p>
                        </div>
                        <span className="text-sm font-bold text-blue-600">{combo.newStock} available</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Return Form */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="space-y-4">
          {/* SKU Selection */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label htmlFor="sku" className="block text-sm font-medium text-gray-700">
                Select Single SKU
              </label>
              <button onClick={fetchSingleSkus} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <RefreshCw size={12} className={loadingSkus ? 'animate-spin' : ''} /> Refresh List
              </button>
            </div>

            <select
              id="sku"
              value={selectedSku}
              onChange={(e) => setSelectedSku(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={updating || loadingSkus}
            >
              <option value="">-- Select a SKU --</option>
              {singleSkus.length > 0 ? (
                singleSkus.map((sku) => (
                  <option key={sku.sku} value={sku.sku}>
                    {sku.sku} - {sku.name}
                  </option>
                ))
              ) : (
                <option disabled>Loading SKUs...</option>
              )}
            </select>
          </div>

          {/* Condition Selection (Required) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Condition <span className="text-red-500">*</span>
            </label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as 'lost' | 'damaged' | 'good' | '')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={updating}
              required
            >
              <option value="">-- Select condition --</option>
              <option value="good">Good - Item is in good condition</option>
              <option value="damaged">Damaged - Item is damaged</option>
              <option value="lost">Lost - Item is lost</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Select the physical condition of the returned item after QC inspection.
            </p>
          </div>

          {/* Quantity Input */}
          <div>
            <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-2">
              Quantity <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              id="quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Enter quantity"
              min="1"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={updating}
              required
            />
          </div>

          {/* Order ID Input (Optional) */}
          <div>
            <label htmlFor="orderId" className="block text-sm font-medium text-gray-700 mb-2">
              Order ID (Optional)
            </label>
            <input
              type="text"
              id="orderId"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="Enter order ID (optional)"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={updating}
            />
            <p className="text-xs text-gray-500 mt-1">
              Link this refund/return to the original order (optional).
            </p>
          </div>

          {/* Notes Input */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes about the refund/return"
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={updating}
            />
          </div>

          {/* Submit Button */}
          <button
            onClick={handleReturn}
            disabled={updating || !selectedSku || !quantity || !condition}
            className="w-full px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {updating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Processing...
              </>
            ) : (
              <>
                <ArrowLeftCircle className="w-4 h-4" />
                Process Refund/Return
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

