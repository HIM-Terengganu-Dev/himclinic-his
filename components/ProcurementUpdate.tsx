'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, Plus, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

interface SingleSku {
  id: number;
  sku: string;
  name: string;
  woocommerce_product_id: number;
}

interface ProcurementUpdateProps {
  onStockUpdated: () => void;
}

export default function ProcurementUpdate({ onStockUpdated }: ProcurementUpdateProps) {
  const [singleSkus, setSingleSkus] = useState<SingleSku[]>([]);
  const [loadingSkus, setLoadingSkus] = useState(false);

  const [selectedSku, setSelectedSku] = useState('');
  const [quantity, setQuantity] = useState('');
  const [operation, setOperation] = useState<'add' | 'subtract' | 'set'>('add');
  const [notes, setNotes] = useState('');

  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSingleSkus();
  }, []);

  const fetchSingleSkus = async () => {
    setLoadingSkus(true);
    try {
      const res = await fetch('/api/skus/single');
      const data = await res.json();
      if (data.skus) {
        setSingleSkus(data.skus);
      }
    } catch (error) {
      console.error('Failed to fetch SKUs', error);
    } finally {
      setLoadingSkus(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedSku || !quantity) {
      setError('Please select a SKU and enter quantity');
      return;
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 0) {
      setError('Please enter a valid quantity');
      return;
    }

    // Notes are required for Reconciliation (set operation)
    if (operation === 'set' && !notes.trim()) {
      setError('Notes are required for Reconciliation');
      return;
    }

    setUpdating(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/procurement/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: selectedSku,
          quantity: qty,
          operation,
          notes // Included notes
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
        onStockUpdated();
        setQuantity('');
        setNotes('');
      } else {
        setError(data.error || 'Failed to update stock');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Procurement Stock Update
        </h2>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-blue-800">
            <strong>💡 Manual Stock Updates:</strong> Use this section to manually add or set stock quantities
            for single SKUs. Changes are recorded in the HIS database.
          </p>
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
              <h3 className="text-lg font-semibold text-green-900">Stock Updated Successfully!</h3>
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-2">Updated Single SKU</h4>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-700">{result.sku}</span>
                  <span className="text-lg font-bold text-green-600">{result.newLocalQuantity} units</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-green-700">Stock updated successfully ✓</span>
                </div>
              </div>

            </div>
          </div>
        )}
      </div>

      {/* Update Form */}
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

          {/* Operation Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Operation</label>
            <div className="flex flex-col gap-3">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  value="add"
                  checked={operation === 'add'}
                  onChange={(e) => setOperation(e.target.value as 'add')}
                  className="mr-2"
                  disabled={updating}
                />
                <span className="text-sm text-gray-700">Manual stock in</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  value="subtract"
                  checked={operation === 'subtract'}
                  onChange={(e) => setOperation(e.target.value as 'subtract')}
                  className="mr-2"
                  disabled={updating}
                />
                <span className="text-sm text-gray-700">Manual stock out</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  value="set"
                  checked={operation === 'set'}
                  onChange={(e) => setOperation(e.target.value as 'set')}
                  className="mr-2"
                  disabled={updating}
                />
                <span className="text-sm text-gray-700">Reconciliation</span>
              </label>
            </div>
          </div>

          {/* Quantity Input */}
          <div>
            <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-2">
              Quantity
            </label>
            <input
              type="number"
              id="quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Enter quantity"
              min="0"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={updating}
            />
          </div>

          {/* Notes Input */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
              Notes {operation === 'set' ? <span className="text-red-500">*</span> : '(Optional)'}
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={operation === 'set' ? "Reason for reconciliation (required)" : "Reason for update (e.g., Restock from supplier, Adjustment)"}
              rows={2}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                operation === 'set' && !notes.trim() ? 'border-red-300' : 'border-gray-300'
              }`}
              disabled={updating}
              required={operation === 'set'}
            />
          </div>

          {/* Submit Button */}
          <button
            onClick={handleUpdate}
            disabled={updating || !selectedSku || !quantity || (operation === 'set' && !notes.trim())}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {updating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Updating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Update Stock
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}



