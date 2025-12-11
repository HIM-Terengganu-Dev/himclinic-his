'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import StockTakeForm from '@/components/StockTakeForm';
import StockTakeReport from '@/components/StockTakeReport';
import LoginPage from '@/components/LoginPage';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function StockTakePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stockTakeData, setStockTakeData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchCurrentStockTake();
    }
  }, [status]);

  const fetchCurrentStockTake = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/stock-take/current');
      const data = await response.json();
      if (data.success) {
        setStockTakeData(data);
      }
    } catch (error) {
      console.error('Error fetching current stock take:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStockTake = async () => {
    try {
      setCreating(true);
      const response = await fetch('/api/stock-take/create', {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        // Use the data directly from create response, then refetch to ensure consistency
        if (data.stockTake && data.items) {
          setStockTakeData(data);
        }
        // Refetch to ensure we have the latest data with all items
        await fetchCurrentStockTake();
      } else {
        console.error('Failed to create stock take:', data);
        const errorMsg = data.error || 'Failed to create stock take. Please try again.';
        alert(errorMsg);
        if (data.details) {
          console.error('Error details:', data.details);
        }
      }
    } catch (error) {
      console.error('Error creating stock take:', error);
      alert('Network error. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleStockTakeComplete = () => {
    fetchCurrentStockTake();
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-gray-600">Loading stock take...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Back Button */}
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <ArrowLeft size={20} />
          <span>Back to Dashboard</span>
        </button>

        {/* Content */}
        {!stockTakeData?.stockTake ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div className="text-center max-w-2xl mx-auto">
              <h1 className="text-2xl font-bold text-gray-900 mb-4">
                Stock Take - {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
              </h1>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-left">
                <p className="text-sm text-blue-800 mb-2">
                  <strong>How it works:</strong>
                </p>
                <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
                  <li>Clicking "Start Stock Take" creates a <strong>snapshot</strong> (freeze) of current stock levels from WooCommerce</li>
                  <li>This snapshot is stored and won't change, even if stock changes later</li>
                  <li>You can do stock take for previous month (e.g., December stock take in January)</li>
                  <li>Only one stock take is allowed per month</li>
                </ul>
                <p className="text-xs text-blue-600 mt-3 italic">
                  Note: The snapshot captures current stock when you create it. For historical stock (e.g., Dec 31 11:59pm), 
                  create the stock take as close to that time as possible, or create it on Jan 1st if you need December's end-of-month stock.
                </p>
              </div>
              <button
                onClick={handleCreateStockTake}
                disabled={creating}
                className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2 mx-auto"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating Stock Take...
                  </>
                ) : (
                  'Start Stock Take (Freeze Current Stock)'
                )}
              </button>
            </div>
          </div>
        ) : stockTakeData.stockTake.status === 'completed' ? (
          <StockTakeReport
            stockTake={stockTakeData.stockTake}
            items={stockTakeData.items || []}
          />
        ) : (
          <StockTakeForm
            stockTake={stockTakeData.stockTake}
            items={stockTakeData.items || []}
            onComplete={handleStockTakeComplete}
          />
        )}
      </div>
    </div>
  );
}

