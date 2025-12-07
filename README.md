# Telehealth Inventory Management System

A real-time inventory management system for ForHim Clinic telehealth products, integrating with WooCommerce API for seamless order processing and stock management.

## Features

### 🎯 Core Functionality
- **Automatic Order Processing**: Orders automatically processed from WooCommerce every 30 seconds
- **Real-time Stock Tracking**: Monitor single SKU inventory levels in real-time
- **Combo SKU Calculation**: Automatically calculate available combo SKUs based on single SKU components
- **Smart Stock Deduction**: Automatic stock deduction when orders are detected
- **Stock Constraints**: Enforce component-based limits on combo SKU availability
- **Zero Manual Input**: No manual order processing needed

### 📊 Dashboard Features
- **Single Unified Dashboard**: All inventory information in one place
- **Single SKU Inventory View**: Visual cards showing stock levels with low stock warnings
- **Combo SKU Availability Table**: Detailed view of combo products with limiting components
- **Recently Processed Orders**: See last 20 orders processed automatically
- **Auto-Refresh Toggle**: Automatically update dashboard every 30 seconds (can be toggled ON/OFF)
- **Real-time Notifications**: Get notified when new orders are processed
- **Real-time Statistics**: Total stock, combo availability, and low stock alerts

### 🔐 API Access
- **READ Access**: Fetch products and orders from WooCommerce (automatic every 30s)
- **WRITE Access**: Update both single SKU and combo SKU stock in WooCommerce (automatic after order processing)
- **In-Memory Storage**: Single SKU inventory maintained locally (initialized from WooCommerce stock on startup)
- **Auto-Refresh**: Dashboard updates every 30 seconds to reflect changes
- **Automatic Order Processing**: Orders detected and processed with READ-only access
- **Bidirectional Sync**: Single SKUs and combo SKUs stay synchronized with WooCommerce

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

### Automatic Operation

**The system runs automatically:**
1. Open the dashboard (or leave it open with auto-refresh)
2. Every 30 seconds, the system:
   - Checks for new "processing" orders in WooCommerce
   - Automatically processes any new orders
   - Deducts stock for single and combo SKUs
   - Updates WooCommerce stock quantities
   - Shows notifications for processed orders
3. No manual input required!

### Dashboard View
- View all single SKU inventory levels
- See combo SKU availability with limiting components  
- Monitor low stock and out-of-stock items
- Color-coded alerts (green = in stock, yellow = low stock, red = out of stock)
- **Auto-Refresh**: Toggle ON/OFF to automatically update every 30 seconds
- **Recently Processed Orders**: See last 20 orders with details
- **Real-time Notifications**: Get alerts when orders are processed
- **Last Updated**: Shows when data was last refreshed

### 2. Automatic Order Processing
- System checks WooCommerce every 30 seconds for new orders
- Automatically processes orders with "processing" status
- Deducts stock for both single and combo SKUs
- Updates WooCommerce stock quantities automatically
- Shows recently processed orders on dashboard
- Displays notifications when new orders are processed
- No manual order ID entry required

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

### POST `/api/orders/process`
Process a WooCommerce order
- Body: `{ orderId: number }`
- Deducts stock based on order items

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

### ⚠️ In-Memory Storage
- Single SKU inventory is stored in memory (resets on server restart)
- **Initialized from WooCommerce** on startup (reads actual stock quantities)
- Falls back to 0 if product not found or stock not managed
- For production, implement database persistence

### 🔄 Auto-Refresh Feature
- Dashboard refreshes every 30 seconds when enabled
- Catches changes from WooCommerce or other sources
- Can be toggled ON/OFF via button in header
- Shows visual indicator (pulsing green dot) when active
- Displays last updated timestamp

### 🔒 WRITE API Usage
- **READ access**: Used for automatically fetching products and orders every 30 seconds
- **WRITE access**: Used after processing orders for:
  - Updating single SKU stock in WooCommerce
  - Updating combo SKU stock in WooCommerce
- WRITE updates both single and combo SKUs based on calculated availability
- This ensures WooCommerce stock is always accurate for both product types
- Single SKUs can be sold individually with accurate stock levels
- Orders are READ-only (never written to)

### 🎯 Stock Deduction Flow
1. Order comes in with line items
2. System checks if each item is single SKU or combo SKU
3. Single SKUs: Direct deduction
4. Combo SKUs: Break down to components and deduct each
5. Inventory updated in memory
6. Dashboard reflects new stock levels

### 📦 Procurement Update Flow
1. User adds single SKU quantity
2. Local inventory updated
3. **Single SKU written to WooCommerce** (new stock quantity)
4. System calculates affected combo SKUs
5. WooCommerce API called to update combo SKU stock
6. Dashboard shows updated availability with sync status

## Future Enhancements

- [ ] Database integration (PostgreSQL/MySQL)
- [ ] Persistent inventory storage
- [ ] Order history logging
- [ ] Stock movement reports
- [ ] Low stock email alerts
- [ ] Automatic reorder points
- [ ] Batch order processing
- [ ] Export inventory reports
- [ ] Multi-user access control
- [ ] Audit trail for stock changes

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

