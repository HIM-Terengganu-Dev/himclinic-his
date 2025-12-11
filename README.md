# Telehealth Inventory Management System

A real-time inventory management system for ForHim Clinic telehealth products, integrating with WooCommerce API for seamless order processing and stock management.

## Features

### 🎯 Core Functionality
- **Webhook-Based Stock Updates**: Automatic WooCommerce stock updates when orders are processed
- **Database-Backed SKU Management**: All SKU definitions stored in Neon PostgreSQL database
- **Real-time Stock Tracking**: Monitor single SKU inventory levels in real-time
- **Combo SKU Calculation**: Automatically calculate available combo SKUs based on single SKU components
- **Manual Stock Updates**: Procurement tab for manual stock adjustments (add/subtract/reconcile)
- **Stock Take Feature**: Monthly stock take with physical count reconciliation
- **Activity Logging**: Complete audit trail of all system activities

### 📊 Dashboard Features
- **Single Unified Dashboard**: All inventory information in one place
- **Single SKU Inventory View**: Table format showing stock levels with low stock warnings
- **Combo SKU Availability Table**: Detailed view of combo products with limiting components
- **Procurement Tab**: Manual stock updates (Manual Stock In, Manual Stock Out, Reconciliation)
- **Activity Log Tab**: View all system activities with date and SKU filters
- **Stock Take Feature**: Monthly stock take with variance tracking
- **Auto-Refresh**: Automatically update dashboard every 5 minutes
- **Real-time Statistics**: Total stock, combo availability, and low stock alerts

### 🔐 API Access & Data Flow
- **Webhook Handler**: Receives WooCommerce order webhooks, validates against database, updates stock
- **Manual Updates**: Procurement tab updates both database and WooCommerce stock
- **Read-Only API**: `/api/inventory` route fetches stock for display only (no updates)
- **Database**: Neon PostgreSQL stores SKU definitions, activity logs, and stock take records
- **Bidirectional Sync**: Stock updates flow to WooCommerce, stock levels read from WooCommerce
- **Auto-Refresh**: Dashboard updates every 5 minutes to reflect changes

## Architecture

### SKU Structure

**Single SKUs** (Base components):
- `him1` - HIM Coffee by Dr. Samhan
- `spu1` - Spray Up 10ml
- `tad5/10tab` - Pil Harian 5mg (10 Hari)
- `tad20/4tab` - Pil Hujung Minggu 20mg
- `iqn100/4tab` - Pil Biru Generik 100mg
- And more... (12 total single SKUs)

**Combo SKUs** (Composed of single SKUs):
- `kom/spu+him` - KOMBO Spray Up + Him Coffee (1× spu1 + 1× him1)
- `him3` - HIM Coffee x 3 (3× him1)
- `spu5` - Spray Up x 5 Botol (5× spu1)
- And more... (18 total combo SKUs)

### Stock Calculation Logic

1. **Single SKU Deduction**: Direct subtraction from inventory
2. **Combo SKU Deduction**: Breaks down to component single SKUs and deducts each
3. **Combo Availability**: Calculated as `min(component1_stock / component1_qty, component2_stock / component2_qty)`
4. **Stock Constraints**: Combo SKU max availability limited by the bottleneck component

### Example

If you have:
- `spu1`: 50 units
- `him1`: 100 units

Then `kom/spu+him` (requires 1× spu1 + 1× him1) can have:
- Max 50 units available (limited by spu1)

If you add 100 more `him1` units:
- Still max 50 units of `kom/spu+him` (still limited by spu1)

If you add 50 more `spu1` units:
- Now max 100 units of `kom/spu+him` (now limited by him1)

## Installation

### Prerequisites
- Node.js 18+ and npm
- WooCommerce store with API credentials

### Setup Steps

1. **Clone the repository**
   ```bash
   cd telehealth-inventory-management-system
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your WooCommerce credentials:
   ```env
   WOOCOMMERCE_STORE_URL=https://forhimclinic.com
   WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxx
   WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxx
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open the application**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

### Initial Stock Setup

**On first startup**, the system automatically:
1. Fetches all products from WooCommerce
2. Reads stock quantities for single SKUs (by product ID)
3. Initializes inventory with actual WooCommerce stock
4. Falls back to 0 if product not found or stock not managed

**Requirements:**
- Single SKU products must exist in WooCommerce with correct IDs
- "Manage stock" must be enabled for each product
- Stock quantities must be set (not null)

### Automatic Operation (Webhook)

**When an order is processed in WooCommerce:**
1. WooCommerce sends webhook to `/api/webhooks/orders`
2. Webhook validates line items against database
3. System automatically:
   - Deducts single SKU stock in WooCommerce
   - Breaks down combo SKUs to components
   - Deducts component stock
   - Recalculates combo SKU availability
   - Updates combo SKU stock in WooCommerce
   - Logs all updates to activity log
4. No manual intervention required!

**Note**: Webhook must be configured in WooCommerce settings to send order updates to your webhook URL.

### Dashboard View
- **Inventory Tab**: View all single SKU inventory levels (table format) and combo SKU availability
- **Procurement Tab**: Manual stock updates (add/subtract/reconcile)
- **Activity Log Tab**: View all system activities with filters
- Monitor low stock and out-of-stock items
- Color-coded alerts (green = in stock, yellow = low stock, red = out of stock)
- **Auto-Refresh**: Dashboard automatically updates every 5 minutes
- **Last Updated**: Shows when data was last refreshed

### Manual Stock Updates (Procurement Tab)
- **Manual Stock In**: Add quantity to existing stock
- **Manual Stock Out**: Remove quantity from stock
- **Reconciliation**: Set stock to specific quantity (notes required)
- Updates both database (activity log) and WooCommerce stock
- Automatically recalculates affected combo SKU availability

## API Endpoints

### GET `/api/products`
Fetch all products from WooCommerce

### GET `/api/orders`
Fetch orders from WooCommerce
- Query params: `limit`, `status`

### GET `/api/inventory`
Get current inventory state
- Returns: single SKU stocks and combo SKU availability

### POST `/api/inventory`
Update inventory
- Body: `{ action: 'set' | 'add' | 'subtract', sku: string, quantity: number }`

### POST `/api/webhooks/orders`
Handle WooCommerce order webhook
- Triggered when order status changes to `processing`
- Validates line items against database
- Updates WooCommerce stock for single and combo SKUs

### POST `/api/procurement/update`
Update single SKU stock (uses WRITE API for combos)
- Body: `{ sku: string, quantity: number, operation: 'add' | 'set' }`
- Updates WooCommerce combo SKU stock quantities

### POST `/api/stock/update`
Direct WooCommerce stock update
- Body: `{ productId: number, stockQuantity: number }`

## Project Structure

```
telehealth-inventory-management-system/
├── app/
│   ├── api/
│   │   ├── inventory/
│   │   │   └── route.ts         # Inventory management API
│   │   ├── orders/
│   │   │   ├── route.ts         # Fetch orders
│   │   │   └── process/
│   │   │       └── route.ts     # Process orders
│   │   ├── products/
│   │   │   └── route.ts         # Fetch products
│   │   ├── procurement/
│   │   │   └── update/
│   │   │       └── route.ts     # Procurement updates
│   │   └── stock/
│   │       └── update/
│   │           └── route.ts     # WooCommerce stock update
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Main dashboard page
│   └── globals.css              # Global styles
├── components/
│   ├── InventoryDashboard.tsx   # Stock display component
│   ├── OrderProcessor.tsx       # Order processing component
│   └── ProcurementUpdate.tsx    # Procurement update component
├── lib/
│   ├── data/
│   │   ├── single-skus.ts       # Single SKU definitions
│   │   └── combo-skus.ts        # Combo SKU definitions
│   ├── services/
│   │   └── woocommerce.ts       # WooCommerce API client
│   └── utils/
│       └── inventory.ts         # Inventory calculation utilities
├── types/
│   └── inventory.ts             # TypeScript type definitions
├── single_sku_list.csv          # Single SKU reference data
├── combo_sku_list.csv           # Combo SKU reference data
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── README.md
```

## Data Files

### `single_sku_list.csv`
Contains all base single SKU products with their WooCommerce IDs, SKU codes, and names.

### `combo_sku_list.csv`
Contains all combo SKU products with their components and quantities required.

## Important Notes

### ⚠️ Database-Backed System
- All SKU definitions stored in Neon PostgreSQL database
- Stock levels fetched from WooCommerce in real-time
- Activity logs and stock take records stored in database
- Webhook validates against database (not static files)

### 🔄 Auto-Refresh Feature
- Dashboard refreshes every 5 minutes automatically
- Fetches fresh stock from WooCommerce
- Displays last updated timestamp

### 🔒 WRITE API Usage
- **Webhook**: Updates WooCommerce stock when orders are processed
  - Deducts single SKU stock
  - Breaks down combo SKUs and deducts components
  - Recalculates and updates combo SKU availability
- **Manual Updates**: Procurement tab updates WooCommerce stock
  - Updates single SKU stock
  - Recalculates affected combo SKUs
  - Updates combo SKU stock
- **Read-Only API**: `/api/inventory` route only fetches stock for display

### 🎯 Webhook Stock Deduction Flow
1. WooCommerce sends webhook when order status = `processing`
2. Webhook validates line items against database
3. For each line item:
   - Single SKU: Add to deductions map
   - Combo SKU: Break down to components, add to deductions map
4. Update WooCommerce stock for each single SKU
5. Recalculate affected combo SKU availability
6. Update combo SKU stock in WooCommerce
7. Log all updates to activity log

### 📦 Procurement Update Flow
1. User adds single SKU quantity
2. Local inventory updated
3. **Single SKU written to WooCommerce** (new stock quantity)
4. System calculates affected combo SKUs
5. WooCommerce API called to update combo SKU stock
6. Dashboard shows updated availability with sync status

## Current System State

See `CURRENT_STATE.md` for detailed architecture and current implementation status.

## Future Enhancements

- [ ] Low stock email alerts
- [ ] Automatic reorder points
- [ ] Export inventory reports
- [ ] Advanced reporting and analytics
- [ ] Multi-warehouse support

## Technologies Used

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **API Integration**: WooCommerce REST API v3
- **Icons**: Lucide React
- **Date Handling**: date-fns

## Support

For issues or questions, please refer to the documentation files:
- `ENVIRONMENT_VARIABLES.md` - Environment configuration
- `WOOCOMMERCE_API_AND_WEBHOOKS.md` - WooCommerce API reference

## License

Proprietary - ForHim Clinic

---

**Built for ForHim Clinic Telehealth Operations** 🏥

