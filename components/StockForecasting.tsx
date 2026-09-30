'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Calendar,
  Download,
  Copy,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Sparkles,
  Info,
  ShoppingCart,
  Boxes,
  ShieldAlert,
  ArrowRight,
  X,
  HelpCircle,
  Lightbulb,
} from 'lucide-react';
import { SkuForecastItem, ForecastingResult } from '@/lib/db/queries_forecasting';

interface InfoItem {
  title: string;
  badge: string;
  tagline: string;
  description: string;
  formula?: string;
  formulaExplanation?: string;
  whyItMatters: string;
  example?: string;
}

const INFO_DATABASE: Record<string, InfoItem> = {
  col_sku: {
    title: 'Product & SKU Identifier',
    badge: 'Item Master',
    tagline: 'Stock Keeping Unit code and catalog name',
    description:
      'The unique product identifier code and name registered in HIM Clinic inventory and synced with WooCommerce. Single products and combo bundles are tracked here.',
    formulaExplanation:
      'Combo SKUs (e.g. HIM + SPU Combo) automatically explode into their component single SKUs when customer orders arrive. Therefore, demand and burn velocity for single SKUs represent 100% of real physical consumption.',
    whyItMatters:
      'Ensures purchase orders are made for actual manufacturer SKUs and bottles rather than combo package names.',
    example:
      'When an order for 1x "HIM + SPU Combo" is fulfilled, it adds 1 demand unit to single SKU "him1" and 1 unit to single SKU "spu1".',
  },
  col_stock: {
    title: 'Available vs Reserved Stock',
    badge: 'Warehouse Position',
    tagline: 'Physical inventory vs committed customer orders',
    description:
      'Distinguishes between total physical units present in the warehouse and units that are already promised to existing customer orders.',
    formula: 'Available Stock = In Warehouse - (Processing + Pending Consult + Pending Review)',
    formulaExplanation:
      '• In Warehouse: Physical count on the shelf.\n• Reserved: Orders in doctor consultation, medical review, or packing queue.\n• Available: Free inventory ready to fulfill new incoming sales.',
    whyItMatters:
      'Prevents dangerous stockouts and overselling. If a warehouse has 20 units, but 16 are reserved for doctor consultation orders, only 4 units can safely be sold.',
    example:
      'tra/10tab has 21 units in warehouse, 13 processing, and 3 pending review. Available = 21 - 16 = 5 units available.',
  },
  col_velocity: {
    title: 'Daily Sales Velocity (Burn Rate)',
    badge: 'Consumption Speed',
    tagline: 'Average daily rate of stock depletion',
    description:
      'The average number of units consumed/shipped per calendar day over the selected demand lookback window (default 30 days).',
    formula: 'Daily Velocity = (Units Sold in Lookback Window / Window Days) × (1 + Demand Surge %)',
    formulaExplanation:
      '• Lookback Units: Real fulfilled orders (Ninja Van pending pickup).\n• Trend Arrow: Compares 7-day velocity to 30-day baseline.\n  ↗️ Accelerating: 7d rate > 20% higher than baseline.\n  ➡️ Steady: 7d rate within ±20%.\n  ↘️ Slowing: 7d rate > 20% lower than baseline.',
    whyItMatters:
      'Velocity is the fundamental heartbeat of inventory planning. It eliminates guesswork and bases purchasing on actual customer consumption speed.',
    example:
      'Pil Tahan Lama sold 113 units in the last 30 days. Daily velocity = 113 ÷ 30 = 3.77 units/day.',
  },
  col_days_left: {
    title: 'Days of Stock Left & Stockout Date',
    badge: 'Depletion Runway',
    tagline: 'Remaining time until inventory reaches zero',
    description:
      'How many days current available stock will last before hitting 0, assuming current daily burn rate continues.',
    formula: 'Days Left = Available Stock / Daily Burn Velocity\nEstimated Stockout Date = Today + Days Left',
    formulaExplanation:
      'Critical Warning Zone: If Days Left ≤ Supplier Lead Time (e.g. 14 days), an order placed today will arrive AFTER warehouse stock has already run out.',
    whyItMatters:
      'Provides an unmistakable countdown clock so clinic operations can reorder before products run out on the WooCommerce store.',
    example:
      'With 5 units available and burning 3.77 units/day: 5 ÷ 3.77 = 1.3 days left. The product will stock out in ~31 hours!',
  },
  col_rop: {
    title: 'Reorder Point (ROP)',
    badge: 'Replenishment Trigger',
    tagline: 'Minimum stock level that triggers a purchase order',
    description:
      'The minimum inventory threshold that signals an urgent purchase order must be placed with the supplier to avoid a stockout.',
    formula: 'ROP = Lead Time Demand (LTD) + Safety Stock Buffer (SS)\n• LTD = Daily Velocity × Supplier Lead Time (Days)\n• SS = Daily Velocity × Safety Buffer (Days)',
    formulaExplanation:
      'When Available Stock ≤ ROP, order immediately! Ordering at ROP ensures the new supplier delivery arrives exactly as current stock reaches the safety buffer.',
    whyItMatters:
      'Ordering when stock is already zero is too late because the supplier takes 14 days to manufacture and deliver. ROP builds in this turnaround window.',
    example:
      'Velocity = 3.77/day, Lead Time = 14 days (53 units), Safety Buffer = 14 days (53 units). ROP = 53 + 53 = 106 units.',
  },
  col_status: {
    title: 'Inventory Health Classification',
    badge: 'Health Status',
    tagline: 'Automated urgency and risk categorization',
    description:
      'Categorizes each SKU into priority tiers so staff can address high-risk shortages first.',
    formulaExplanation:
      '🔴 Critical: Stock ≤ 0 or Days Left ≤ Lead Time (will stock out before delivery).\n🟡 Reorder: Available Stock ≤ Reorder Point (place order now).\n🟢 Healthy: Stock is above ROP with optimal supply.\n🔵 Overstocked: Stock covers > 90 days (excess capital tied up).\n⚪ Inactive: No sales recorded in the window.',
    whyItMatters:
      'Enables management by exception: focus immediately on red and yellow items without getting lost in stable inventory.',
  },
  col_roq: {
    title: 'Best Order Quantity (ROQ)',
    badge: 'Purchase Order Sizing',
    tagline: 'Mathematically optimal quantity to order from supplier',
    description:
      'The exact number of units to order from the manufacturer to cover supplier turnaround time plus the desired order cycle (e.g. 30 days) without overstocking.',
    formula: 'Target Stock (S) = [Velocity × (Lead Time Days + Target Cycle Days)] + Safety Stock\nROQ = max(0, ⌈Target Stock (S) - Available Stock⌉)',
    formulaExplanation:
      '• Target Stock (S): Maximum desired stock to cover transit delivery + desired cycle.\n• Subtract Available Stock: Ensures you only purchase what you need to reach target.\n• Editable Input: You can adjust the quantity directly in the box to round to box/carton sizes.',
    whyItMatters:
      'Prevents under-ordering (which triggers recurring emergency stockouts) and over-ordering (which ties up clinic working capital).',
    example:
      'Velocity = 3.77/day, Lead Time = 14d, Cycle = 30d, Safety Buffer = 14d. Target Stock = 3.77 × 58 = 219 units. Available = 5. ROQ = 219 - 5 = 214 units.',
  },
  col_details: {
    title: 'SKU Deep Dive & Formula Audit',
    badge: 'Audit & Analytics',
    tagline: 'Step-by-step formula math and historical consumption charts',
    description:
      'Expands the row to reveal a full audit breakdown of how the numbers were calculated for this specific product, alongside 6-month historical monthly consumption bars.',
    whyItMatters:
      'Gives clinic leadership and finance teams full transparency into why an order size was chosen before signing off on purchase orders.',
  },
  kpi_critical: {
    title: 'Critical Stockout Alert',
    badge: 'KPI Metric',
    tagline: 'Products facing imminent or active stock depletion',
    description:
      'The count of active SKUs that have either 0 available stock or fewer days of supply remaining than the supplier delivery turnaround time.',
    whyItMatters:
      'Requires immediate emergency attention or expedited supplier freight to minimize revenue loss and patient disruption.',
  },
  kpi_reorder: {
    title: 'Reorder Needed Count',
    badge: 'KPI Metric',
    tagline: 'SKUs currently below their Reorder Point',
    description:
      'The number of active products whose current available inventory has dropped to or below their Reorder Point (ROP).',
    whyItMatters:
      'Indicates purchase orders that should be issued during this procurement cycle to maintain uninterrupted fulfillment.',
  },
  kpi_order: {
    title: 'Recommended Order Units',
    badge: 'KPI Metric',
    tagline: 'Total units recommended across all SKUs',
    description:
      'The combined total units recommended to order from suppliers across all active products to satisfy the target stock coverage cycle.',
    whyItMatters:
      'Helps finance quickly estimate overall purchase order budget, packaging volume, and logistics cargo size.',
  },
  kpi_coverage: {
    title: 'Average Days of Supply',
    badge: 'KPI Metric',
    tagline: 'Overall inventory coverage runway',
    description:
      'The average number of days that current warehouse inventory can support business operations at present sales velocity.',
    whyItMatters:
      'Benchmarking inventory health: between 30 and 60 days is generally optimal for clinic pharmaceutical and supplement supplies.',
  },
  param_window: {
    title: 'Demand Lookback Window',
    badge: 'Parameter Control',
    tagline: 'Time horizon for daily burn rate calculation',
    description:
      'Controls how far back the system looks into historical transactions to calculate daily burn rate.',
    formulaExplanation:
      '• 14 Days: High responsiveness to recent marketing spikes or short-term trends.\n• 30 Days (Recommended): Standard balanced lookback smoothing weekend variations.\n• 60/90 Days: Smooth long-term baseline for slow-moving products.',
    whyItMatters:
      'Allows you to tune whether your reorder recommendations react quickly to sudden demand spikes or remain steady.',
  },
  param_leadtime: {
    title: 'Supplier Lead Time',
    badge: 'Parameter Control',
    tagline: 'Turnaround time from PO placement to warehouse arrival',
    description:
      'The number of calendar days it takes for a manufacturer/supplier to produce, ship, and deliver physical inventory to the clinic warehouse.',
    whyItMatters:
      'Longer lead times require earlier reorder triggers (higher ROP) and larger safety buffers to prevent stockouts while waiting for shipment.',
  },
  param_buffer: {
    title: 'Safety Stock Buffer',
    badge: 'Parameter Control',
    tagline: 'Insurance cushion against unexpected spikes or delays',
    description:
      'The number of extra days of stock kept on hand as a risk buffer against unexpected order surges or courier delays.',
    whyItMatters:
      'Protects revenue. If a supplier delivery is delayed by 5 days, a 14-day safety buffer ensures patients never experience an out-of-stock notice.',
  },
  param_cycle: {
    title: 'Target Stock Coverage (Order Cycle)',
    badge: 'Parameter Control',
    tagline: 'How many days each purchase order batch should last',
    description:
      'The desired inventory horizon to buy for when placing a new order (e.g. 30 days, 45 days, or 60 days of stock).',
    whyItMatters:
      'Balancing shipping costs and holding costs. A 30-day cycle keeps cash lean; a 60-day cycle reduces purchasing paperwork and freight frequency.',
  },
  param_surge: {
    title: 'Projected Demand Surge',
    badge: 'Parameter Control',
    tagline: 'Anticipate upcoming marketing campaigns or promotions',
    description:
      'An optional growth multiplier applied to current daily sales velocity to prepare for upcoming ad campaigns, payday sales, or seasonal promotions.',
    whyItMatters:
      'Historical sales look backward; this setting allows you to look forward and order enough stock before major marketing campaigns kick off.',
    example:
      'Setting +30% scales a 10 unit/day product to 13 units/day, ordering 30% more stock to prevent campaign stockouts.',
  },
};

interface StockForecastingProps {
  onNavigateToProcurement?: () => void;
}

export default function StockForecasting({ onNavigateToProcurement }: StockForecastingProps) {
  // Data state
  const [data, setData] = useState<ForecastingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Parameter controls
  const [windowDays, setWindowDays] = useState<number>(30);
  const [leadTimeDays, setLeadTimeDays] = useState<number>(14);
  const [bufferDays, setBufferDays] = useState<number>(14);
  const [cycleDays, setCycleDays] = useState<number>(30);
  const [growthRate, setGrowthRate] = useState<number>(0);

  // UI state
  const [showParameters, setShowParameters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'critical' | 'reorder' | 'healthy' | 'overstocked' | 'inactive'>('all');
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Info Modal state
  const [activeInfoKey, setActiveInfoKey] = useState<string | null>(null);

  // Custom SKU order quantity overrides
  const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});

  const fetchForecast = async (showLoadingIndicator = true) => {
    if (showLoadingIndicator) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        windowDays: windowDays.toString(),
        leadTimeDays: leadTimeDays.toString(),
        bufferDays: bufferDays.toString(),
        cycleDays: cycleDays.toString(),
        growthRate: growthRate.toString(),
      });

      const res = await fetch(`/api/forecasting?${params.toString()}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load forecasting data');
      }
      setData(json);
    } catch (err: any) {
      console.error('Forecasting fetch error:', err);
      setError(err.message || 'Error loading forecast');
    } finally {
      if (showLoadingIndicator) setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecast(true);
  }, [windowDays, leadTimeDays, bufferDays, cycleDays, growthRate]);

  // Filter items
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];

    return data.items.filter((item) => {
      const matchesSearch =
        item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (statusFilter === 'critical') return item.status === 'critical_stockout';
      if (statusFilter === 'reorder') return item.status === 'critical_stockout' || item.status === 'reorder_needed';
      if (statusFilter === 'healthy') return item.status === 'healthy';
      if (statusFilter === 'overstocked') return item.status === 'overstocked';
      if (statusFilter === 'inactive') return item.status === 'inactive';

      return true;
    });
  }, [data, searchQuery, statusFilter]);

  const handleQtyChange = (sku: string, value: number) => {
    setCustomQuantities((prev) => ({
      ...prev,
      [sku]: Math.max(0, value),
    }));
  };

  const getActiveQty = (item: SkuForecastItem) => {
    if (customQuantities[item.sku] !== undefined) {
      return customQuantities[item.sku];
    }
    return item.recommendedOrderQty;
  };

  const dynamicTotalUnitsToOrder = useMemo(() => {
    if (!data?.items) return 0;
    return data.items.reduce((sum, item) => sum + getActiveQty(item), 0);
  }, [data, customQuantities]);

  const handleExportCSV = () => {
    if (!data?.items) return;

    const headers = [
      'SKU Code',
      'Product Name',
      'In Warehouse',
      'Reserved (Processing/Pending)',
      'Available For Sale',
      'Daily Velocity (units/day)',
      'Days of Stock Remaining',
      'Estimated Stockout Date',
      'Reorder Point (ROP)',
      'Status',
      'System Recommended Order Qty',
      'Planned Order Qty',
    ];

    const rows = data.items.map((item) => [
      `"${item.sku}"`,
      `"${item.name.replace(/"/g, '""')}"`,
      item.inWarehouse,
      item.reservedStock,
      item.availableForPurchase,
      item.dailyVelocity,
      item.daysOfStockLeft === 999 ? '999+' : item.daysOfStockLeft,
      item.estimatedStockoutDate ? new Date(item.estimatedStockoutDate).toLocaleDateString() : 'N/A',
      item.reorderPoint,
      item.status,
      item.recommendedOrderQty,
      getActiveQty(item),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `him_clinic_stock_order_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopySummary = () => {
    if (!data?.items) return;

    const itemsToOrder = data.items
      .map((item) => ({
        item,
        qty: getActiveQty(item),
      }))
      .filter((x) => x.qty > 0);

    if (itemsToOrder.length === 0) {
      alert('No items currently have recommended order quantities.');
      return;
    }

    let text = `📦 *HIM CLINIC - PURCHASE ORDER REQUEST*\n`;
    text += `Date: ${new Date().toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' })}\n`;
    text += `Target Cycle: ${cycleDays} Days Supply | Supplier Lead Time: ${leadTimeDays} Days\n`;
    text += `---------------------------------------------------\n`;

    itemsToOrder.forEach(({ item, qty }, idx) => {
      text += `${idx + 1}. *${item.sku}* - ${item.name}\n`;
      text += `   • Order Quantity: *${qty} units*\n`;
      text += `   • Current Available: ${item.availableForPurchase} | Daily Burn: ${item.dailyVelocity}/day\n`;
      text += `   • Status: ${item.status.replace('_', ' ').toUpperCase()}\n\n`;
    });

    text += `---------------------------------------------------\n`;
    text += `*TOTAL UNITS TO ORDER: ${dynamicTotalUnitsToOrder} units across ${itemsToOrder.length} SKUs*\n`;

    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 3000);
  };

  const handleResetParameters = () => {
    setWindowDays(30);
    setLeadTimeDays(14);
    setBufferDays(14);
    setCycleDays(30);
    setGrowthRate(0);
    setCustomQuantities({});
  };

  // Reusable Info Button component
  const InfoBtn = ({ infoKey, className = '' }: { infoKey: string; className?: string }) => {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setActiveInfoKey(infoKey);
        }}
        className={`inline-flex items-center justify-center p-0.5 rounded-full text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors focus:outline-none ${className}`}
        title="Click for full explanation & formula"
      >
        <HelpCircle size={13} className="stroke-[2.2]" />
      </button>
    );
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="relative">
          <div className="w-14 h-14 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin"></div>
          <Boxes className="w-6 h-6 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-gray-900">Calculating Demand Forecasts...</h3>
        <p className="text-sm text-gray-500 mt-1">Analyzing consumption velocity and stockout timelines</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-800">
        <AlertTriangle className="w-10 h-10 text-red-600 mx-auto mb-2" />
        <h3 className="text-lg font-bold">Failed to load forecast</h3>
        <p className="text-sm text-red-600 mt-1">{error}</p>
        <button
          onClick={() => fetchForecast(true)}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition"
        >
          <RefreshCw size={16} /> Try Again
        </button>
      </div>
    );
  }

  const summary = data?.summary || {
    totalSkus: 0,
    criticalCount: 0,
    reorderCount: 0,
    healthyCount: 0,
    overstockedCount: 0,
    inactiveCount: 0,
    totalUnitsToOrder: 0,
    avgDaysOfSupply: 0,
    totalUnitsSold30d: 0,
  };

  const activeInfo = activeInfoKey ? INFO_DATABASE[activeInfoKey] : null;

  return (
    <div className="space-y-6">
      {/* Top Header / Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-6 sm:p-8 rounded-2xl shadow-md relative overflow-hidden">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-200 text-xs font-semibold uppercase tracking-wider mb-2">
            <Sparkles size={13} className="text-blue-300" />
            Replenishment & Demand Intelligence
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Stock Demand & Order Forecast</h2>
          <p className="text-blue-100/80 text-sm mt-1 max-w-2xl">
            Calculates exact replenishment quantities based on live consumption velocity, supplier lead time, and safety buffer days. Click any <HelpCircle size={14} className="inline text-blue-300 mx-0.5" /> icon for full explanation.
          </p>
        </div>

        <div className="flex items-center gap-3 relative z-10">
          <button
            onClick={() => fetchForecast(false)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-medium transition backdrop-blur-sm border border-white/10"
            title="Refresh calculations"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>

          <button
            onClick={handleCopySummary}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs sm:text-sm font-semibold transition shadow-sm"
            title="Copy PO request text"
          >
            {copySuccess ? <CheckCircle2 size={15} /> : <Copy size={15} />}
            {copySuccess ? 'Copied PO!' : 'Copy Order'}
          </button>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold transition shadow-sm"
            title="Download CSV"
          >
            <Download size={15} />
            Export CSV
          </button>
        </div>

        {/* Ambient background decoration */}
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* KPI Stats Cards with Info Buttons */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Critical Stockout */}
        <div className="bg-white rounded-2xl p-5 border border-red-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-red-600 uppercase tracking-wider">Critical Stockout</span>
              <InfoBtn infoKey="kpi_critical" />
            </div>
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-red-600" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-red-950">{summary.criticalCount}</span>
            <span className="text-xs text-gray-500 font-medium">SKUs &lt; {leadTimeDays}d left</span>
          </div>
          <p className="text-xs text-red-600/90 mt-2 font-medium flex items-center gap-1">
            <AlertTriangle size={12} /> Imminent out of stock risk
          </p>
        </div>

        {/* Card 2: Reorder Needed */}
        <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Reorder Needed</span>
              <InfoBtn infoKey="kpi_reorder" />
            </div>
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4 text-amber-600" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-950">{summary.reorderCount}</span>
            <span className="text-xs text-gray-500 font-medium">SKUs below ROP</span>
          </div>
          <p className="text-xs text-amber-600/90 mt-2 font-medium">Place order with supplier now</p>
        </div>

        {/* Card 3: Total Units to Order */}
        <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Recommended Order</span>
              <InfoBtn infoKey="kpi_order" />
            </div>
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <Package className="w-4 h-4 text-blue-600" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-blue-950">{dynamicTotalUnitsToOrder}</span>
            <span className="text-xs text-gray-500 font-medium">total units</span>
          </div>
          <p className="text-xs text-blue-600 mt-2 font-medium">Covers next {cycleDays} days cycle</p>
        </div>

        {/* Card 4: Healthy / Stock Coverage */}
        <div className="bg-white rounded-2xl p-5 border border-emerald-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Avg Coverage</span>
              <InfoBtn infoKey="kpi_coverage" />
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
              <Clock className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-950">{summary.avgDaysOfSupply}</span>
            <span className="text-xs text-gray-500 font-medium">days of supply</span>
          </div>
          <p className="text-xs text-emerald-600 mt-2 font-medium">{summary.healthyCount} SKUs in optimal range</p>
        </div>
      </div>

      {/* Forecasting Parameter Bar (Collapsible) with Info Buttons */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all">
        <div
          onClick={() => setShowParameters(!showParameters)}
          className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50/80 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                Forecasting & Reorder Parameters
                <span className="text-xs font-normal text-gray-500">
                  (Lead Time: {leadTimeDays}d • Safety Buffer: {bufferDays}d • Order Target: {cycleDays}d)
                </span>
              </h3>
              <p className="text-xs text-gray-500">
                Adjust supplier turnaround time, safety stock buffer, and cycle days to simulate different purchase plans.
              </p>
            </div>
          </div>
          <button className="text-gray-400 hover:text-gray-600 p-1">
            {showParameters ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </div>

        {showParameters && (
          <div className="px-6 pb-6 pt-2 border-t border-gray-100 bg-gray-50/50">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 pt-3">
              {/* Parameter 1: Demand History Window */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Lookback Window
                  </label>
                  <InfoBtn infoKey="param_window" />
                </div>
                <select
                  value={windowDays}
                  onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
                  className="w-full text-sm bg-white border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                >
                  <option value={14}>Last 14 Days (Fast Moving)</option>
                  <option value={30}>Last 30 Days (Recommended)</option>
                  <option value={60}>Last 60 Days (Balanced)</option>
                  <option value={90}>Last 90 Days (Smooth/Long-Term)</option>
                </select>
                <p className="text-[11px] text-gray-500 mt-1">Calculates daily burn rate</p>
              </div>

              {/* Parameter 2: Supplier Lead Time */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Supplier Lead Time
                  </label>
                  <InfoBtn infoKey="param_leadtime" />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={leadTimeDays}
                    onChange={(e) => setLeadTimeDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full text-sm bg-white border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                  />
                  <span className="text-xs text-gray-500 font-medium">days</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Order to warehouse arrival</p>
              </div>

              {/* Parameter 3: Safety Stock Buffer */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Safety Stock Buffer
                  </label>
                  <InfoBtn infoKey="param_buffer" />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={bufferDays}
                    onChange={(e) => setBufferDays(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full text-sm bg-white border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                  />
                  <span className="text-xs text-gray-500 font-medium">days</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Buffer against sales spikes</p>
              </div>

              {/* Parameter 4: Order Cycle Days */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Target Coverage
                  </label>
                  <InfoBtn infoKey="param_cycle" />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={7}
                    max={120}
                    value={cycleDays}
                    onChange={(e) => setCycleDays(Math.max(7, parseInt(e.target.value, 10) || 7))}
                    className="w-full text-sm bg-white border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                  />
                  <span className="text-xs text-gray-500 font-medium">days</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Batch duration horizon</p>
              </div>

              {/* Parameter 5: Expected Growth / Surge */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Demand Surge
                  </label>
                  <InfoBtn infoKey="param_surge" />
                </div>
                <select
                  value={growthRate}
                  onChange={(e) => setGrowthRate(parseFloat(e.target.value))}
                  className="w-full text-sm bg-white border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                >
                  <option value={0}>0% (Current Run-Rate)</option>
                  <option value={0.15}>+15% (Campaign / Promo)</option>
                  <option value={0.3}>+30% (High Growth Season)</option>
                  <option value={0.5}>+50% (Major Campaign Surge)</option>
                  <option value={-0.2}>-20% (Cooling Down)</option>
                </select>
                <p className="text-[11px] text-gray-500 mt-1">Anticipate marketing blitzes</p>
              </div>
            </div>

            <div className="flex justify-end mt-4 pt-3 border-t border-gray-200/60">
              <button
                onClick={handleResetParameters}
                className="text-xs text-gray-600 hover:text-gray-900 font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 transition"
              >
                Reset to Recommended Defaults
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search, Filter & Quick Nav Bar */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              statusFilter === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All SKUs ({data?.items.length || 0})
          </button>
          <button
            onClick={() => setStatusFilter('critical')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
              statusFilter === 'critical'
                ? 'bg-red-600 text-white shadow-sm'
                : 'bg-red-50 text-red-700 hover:bg-red-100'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            Critical ({summary.criticalCount})
          </button>
          <button
            onClick={() => setStatusFilter('reorder')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
              statusFilter === 'reorder'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            Reorder Needed ({summary.reorderCount})
          </button>
          <button
            onClick={() => setStatusFilter('healthy')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
              statusFilter === 'healthy'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Healthy ({summary.healthyCount})
          </button>
          <button
            onClick={() => setStatusFilter('overstocked')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              statusFilter === 'overstocked'
                ? 'bg-blue-800 text-white shadow-sm'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            Overstocked ({summary.overstockedCount})
          </button>
          <button
            onClick={() => setStatusFilter('inactive')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              statusFilter === 'inactive'
                ? 'bg-gray-700 text-white shadow-sm'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Inactive ({summary.inactiveCount})
          </button>
        </div>

        {/* Search & Navigation link */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search SKU or Name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs sm:text-sm pl-9 pr-3 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {onNavigateToProcurement && (
            <button
              onClick={onNavigateToProcurement}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition border border-blue-200 whitespace-nowrap"
            >
              Go to Procurement <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Main Forecasting Table with Info Buttons on Every Column Header */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wider select-none">
                {/* Col 1: Product / SKU */}
                <th className="py-3.5 px-4">
                  <div className="flex items-center gap-1.5">
                    <span>Product / SKU</span>
                    <InfoBtn infoKey="col_sku" />
                  </div>
                </th>

                {/* Col 2: Available / Reserved */}
                <th className="py-3.5 px-4 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Available / Reserved</span>
                    <InfoBtn infoKey="col_stock" />
                  </div>
                </th>

                {/* Col 3: Daily Burn Velocity */}
                <th className="py-3.5 px-4 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Daily Burn (Vel)</span>
                    <InfoBtn infoKey="col_velocity" />
                  </div>
                </th>

                {/* Col 4: Stock Remaining */}
                <th className="py-3.5 px-4">
                  <div className="flex items-center gap-1.5">
                    <span>Stock Runway</span>
                    <InfoBtn infoKey="col_days_left" />
                  </div>
                </th>

                {/* Col 5: Reorder Point */}
                <th className="py-3.5 px-4 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Reorder Point (ROP)</span>
                    <InfoBtn infoKey="col_rop" />
                  </div>
                </th>

                {/* Col 6: Status */}
                <th className="py-3.5 px-4 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Status</span>
                    <InfoBtn infoKey="col_status" />
                  </div>
                </th>

                {/* Col 7: Best Order Qty */}
                <th className="py-3.5 px-4 text-center bg-blue-50/70 font-extrabold text-blue-900 border-l border-r border-blue-100">
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Best Order Qty</span>
                    <InfoBtn infoKey="col_roq" />
                  </div>
                </th>

                {/* Col 8: Details */}
                <th className="py-3.5 px-4 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Audit Math</span>
                    <InfoBtn infoKey="col_details" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-500">
                    <Boxes className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="font-semibold text-gray-700">No SKUs match the current filter</p>
                    <p className="text-xs text-gray-400 mt-1">Try changing status filter or clearing search</p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isExpanded = expandedSku === item.sku;
                  const activeQty = getActiveQty(item);

                  const coveragePercent = Math.min(
                    100,
                    item.daysOfStockLeft === 999 ? 100 : (item.daysOfStockLeft / (cycleDays + leadTimeDays)) * 100
                  );

                  return (
                    <tr
                      key={item.sku}
                      className={`hover:bg-gray-50/80 transition-colors ${
                        item.status === 'critical_stockout' ? 'bg-red-50/20' : ''
                      }`}
                    >
                      {/* Product / SKU */}
                      <td className="py-4 px-4">
                        <div>
                          <div className="font-bold text-gray-900 text-sm">{item.name}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                              {item.sku}
                            </span>
                            {item.lowStockThreshold && (
                              <span className="text-[11px] text-gray-400">
                                Min Threshold: {item.lowStockThreshold}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Stock Balance */}
                      <td className="py-4 px-4 text-center">
                        <div className="font-bold text-gray-900 text-base">{item.availableForPurchase}</div>
                        <div className="text-[11px] text-gray-500 flex items-center justify-center gap-1.5">
                          <span>Wh: {item.inWarehouse}</span>
                          {item.reservedStock > 0 && (
                            <span className="text-amber-600 font-medium" title="Processing / Pending orders">
                              (Res: {item.reservedStock})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Daily Velocity & Trend */}
                      <td className="py-4 px-4 text-center">
                        <div className="font-bold text-gray-900">
                          {item.dailyVelocity > 0 ? `${item.dailyVelocity} / day` : '0 / day'}
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-center justify-center gap-1 mt-0.5">
                          <span>{item.sold30d} sold/30d</span>
                          {item.trend === 'accelerating' && (
                            <span className="inline-flex items-center text-emerald-600 font-medium" title="7d sales faster than 30d baseline">
                              <ArrowUpRight size={13} />
                            </span>
                          )}
                          {item.trend === 'slowing' && (
                            <span className="inline-flex items-center text-red-500 font-medium" title="7d sales slower than 30d baseline">
                              <ArrowDownRight size={13} />
                            </span>
                          )}
                          {item.trend === 'steady' && (
                            <span className="inline-flex items-center text-gray-400" title="Steady trend">
                              <Minus size={13} />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Stock Remaining & Run-Out Timeline */}
                      <td className="py-4 px-4 min-w-[170px]">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-bold text-gray-900">
                            {item.daysOfStockLeft === 999
                              ? '999+ days'
                              : `${item.daysOfStockLeft} days`}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            {item.estimatedStockoutDate
                              ? `Out: ${new Date(item.estimatedStockoutDate).toLocaleDateString('en-MY', {
                                  month: 'short',
                                  day: 'numeric',
                                })}`
                              : 'No Stockout'}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              item.status === 'critical_stockout'
                                ? 'bg-red-500'
                                : item.status === 'reorder_needed'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${coveragePercent}%` }}
                          />
                        </div>
                      </td>

                      {/* Reorder Point (ROP) */}
                      <td className="py-4 px-4 text-center">
                        <div className="font-semibold text-gray-800">{item.reorderPoint}</div>
                        <div className="text-[10px] text-gray-400">
                          (LTD {item.leadTimeDemand} + SS {item.safetyStock})
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-4 px-4 text-center">
                        {item.status === 'critical_stockout' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">
                            <ShieldAlert size={12} /> Critical
                          </span>
                        )}
                        {item.status === 'reorder_needed' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            <ShoppingCart size={12} /> Reorder
                          </span>
                        )}
                        {item.status === 'healthy' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 size={12} /> Healthy
                          </span>
                        )}
                        {item.status === 'overstocked' && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                            Overstocked
                          </span>
                        )}
                        {item.status === 'inactive' && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            Low/No Sales
                          </span>
                        )}
                      </td>

                      {/* Recommended Order Quantity */}
                      <td className="py-4 px-4 text-center bg-blue-50/50 border-l border-r border-blue-100">
                        <div className="flex items-center justify-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            value={activeQty}
                            onChange={(e) => handleQtyChange(item.sku, parseInt(e.target.value, 10) || 0)}
                            className={`w-20 text-center font-extrabold text-base py-1 px-1.5 rounded-lg border focus:ring-2 focus:ring-blue-500 focus:outline-none transition shadow-sm ${
                              activeQty > 0
                                ? 'bg-white text-blue-700 border-blue-300 font-bold'
                                : 'bg-gray-50 text-gray-400 border-gray-200'
                            }`}
                          />
                          {customQuantities[item.sku] !== undefined && (
                            <button
                              onClick={() => {
                                const updated = { ...customQuantities };
                                delete updated[item.sku];
                                setCustomQuantities(updated);
                              }}
                              className="text-[10px] text-gray-400 hover:text-red-500"
                              title="Reset to calculated"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        {activeQty > 0 && (
                          <span className="text-[10px] text-blue-600 font-medium block mt-0.5">
                            target: {item.targetStockLevel}
                          </span>
                        )}
                      </td>

                      {/* Details / Expander */}
                      <td className="py-4 px-4 text-center">
                        <button
                          onClick={() => setExpandedSku(isExpanded ? null : item.sku)}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition"
                          title="View historical sales breakdown & formula"
                        >
                          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expanded Row Deep-Dive Card (if a row is expanded) */}
      {expandedSku && (() => {
        const item = data?.items.find((x) => x.sku === expandedSku);
        if (!item) return null;

        return (
          <div className="bg-slate-50 p-6 rounded-2xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-blue-600"></span>
                <h3 className="text-base font-bold text-gray-900">
                  Detailed Inventory & Replenishment Math: <span className="font-mono text-blue-700">{item.name} ({item.sku})</span>
                </h3>
              </div>
              <button
                onClick={() => setExpandedSku(null)}
                className="text-xs text-gray-500 hover:text-gray-800 px-2.5 py-1 rounded-lg border border-gray-300 bg-white"
              >
                Close Audit
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              {/* Box 1: Mathematical Formula Explanation */}
              <div>
                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <Info size={14} className="text-blue-600" />
                  Replenishment Calculation
                </h4>
                <div className="space-y-1.5 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <div className="flex justify-between">
                    <span>Daily Burn Rate:</span>
                    <span className="font-semibold text-gray-900">{item.dailyVelocity} units/day</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Lead Time Demand ({leadTimeDays}d):</span>
                    <span className="font-semibold text-gray-900">+{item.leadTimeDemand} units</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Safety Buffer ({bufferDays}d):</span>
                    <span className="font-semibold text-gray-900">+{item.safetyStock} units</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-1">
                    <span className="font-medium text-gray-700">Reorder Point (ROP):</span>
                    <span className="font-bold text-gray-900">{item.reorderPoint} units</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cycle Target ({cycleDays}d):</span>
                    <span className="font-semibold text-gray-900">
                      +{Math.ceil(item.dailyVelocity * cycleDays)} units
                    </span>
                  </div>
                  <div className="flex justify-between text-blue-700 font-bold border-t border-blue-100 pt-1">
                    <span>Order-Up-To Level:</span>
                    <span>{item.targetStockLevel} units</span>
                  </div>
                  <div className="flex justify-between text-gray-700 border-t border-gray-200 pt-1">
                    <span>Less Available Stock:</span>
                    <span>- {item.availableForPurchase} units</span>
                  </div>
                  <div className="flex justify-between font-extrabold text-blue-900 bg-blue-50 p-1.5 rounded">
                    <span>Best Quantity to Order:</span>
                    <span>{item.recommendedOrderQty} units</span>
                  </div>
                </div>
              </div>

              {/* Box 2: Monthly Sales History */}
              <div>
                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <Calendar size={14} className="text-indigo-600" />
                  Monthly Consumption History
                </h4>
                {item.monthlyHistory.length === 0 ? (
                  <div className="text-xs text-gray-400 p-4 text-center">No monthly history recorded</div>
                ) : (
                  <div className="space-y-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
                    {item.monthlyHistory.map((m) => {
                      const maxUnits = Math.max(1, ...item.monthlyHistory.map((x) => x.units));
                      const barWidth = Math.min(100, Math.round((m.units / maxUnits) * 100));

                      return (
                        <div key={m.month} className="text-xs">
                          <div className="flex justify-between text-gray-600 font-medium mb-0.5">
                            <span>{m.month}</span>
                            <span className="font-bold text-gray-800">{m.units} units</span>
                          </div>
                          <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-indigo-600 h-full rounded-full"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Box 3: Rolling Window Comparison */}
              <div>
                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <TrendingUp size={14} className="text-emerald-600" />
                  Rolling Demand Velocity
                </h4>
                <div className="space-y-2 bg-gray-50 p-3 rounded-lg border border-gray-100 text-xs">
                  <div className="flex justify-between py-1 border-b border-gray-200">
                    <span className="text-gray-600">Last 7 Days:</span>
                    <span className="font-semibold text-gray-900">
                      {item.sold7d} units ({(item.sold7d / 7).toFixed(2)}/day)
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-200">
                    <span className="text-gray-600">Last 14 Days:</span>
                    <span className="font-semibold text-gray-900">
                      {item.sold14d} units ({(item.sold14d / 14).toFixed(2)}/day)
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-200">
                    <span className="text-gray-600">Last 30 Days:</span>
                    <span className="font-semibold text-gray-900">
                      {item.sold30d} units ({(item.sold30d / 30).toFixed(2)}/day)
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-200">
                    <span className="text-gray-600">Last 60 Days:</span>
                    <span className="font-semibold text-gray-900">{item.sold60d} units</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-gray-600">All-Time Units Sold:</span>
                    <span className="font-bold text-blue-700">{item.totalSold} units</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Global Interactive Info Modal */}
      {activeInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in"
          onClick={() => setActiveInfoKey(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl border border-gray-100 relative animate-in zoom-in-95 duration-150 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 mb-2">
                  {activeInfo.badge}
                </span>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900">{activeInfo.title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{activeInfo.tagline}</p>
              </div>
              <button
                onClick={() => setActiveInfoKey(null)}
                className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {/* What It Is */}
              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Info size={14} className="text-blue-600" />
                  What This Data Means
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded-xl border border-gray-100">
                  {activeInfo.description}
                </p>
              </div>

              {/* Mathematical Formula (if applicable) */}
              {(activeInfo.formula || activeInfo.formulaExplanation) && (
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-indigo-600" />
                    Calculation & Formula
                  </h4>
                  <div className="bg-slate-900 text-slate-100 p-3.5 rounded-xl font-mono text-xs leading-relaxed overflow-x-auto shadow-inner">
                    {activeInfo.formula && (
                      <div className="text-emerald-400 font-bold mb-2 pb-2 border-b border-slate-700 whitespace-pre-wrap">
                        {activeInfo.formula}
                      </div>
                    )}
                    {activeInfo.formulaExplanation && (
                      <div className="text-slate-300 whitespace-pre-line text-[11px]">
                        {activeInfo.formulaExplanation}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Why It Matters */}
              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Lightbulb size={14} className="text-amber-500" />
                  Why It Matters For Business
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed bg-amber-50/60 p-3 rounded-xl border border-amber-200/60 text-amber-950">
                  {activeInfo.whyItMatters}
                </p>
              </div>

              {/* Real World Example (if present) */}
              {activeInfo.example && (
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    Real-World Example
                  </h4>
                  <div className="text-xs text-gray-700 bg-emerald-50/60 p-3 rounded-xl border border-emerald-200/60 text-emerald-950 leading-relaxed font-mono">
                    {activeInfo.example}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Got It button */}
            <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setActiveInfoKey(null)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-semibold transition shadow-sm"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
