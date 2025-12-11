# Current System State & Architecture

**Last Updated:** December 2024  
**Version:** 1.4.0

## Overview

The Telehealth Inventory Management System is a Next.js 14 application that manages inventory for ForHim Clinic's telehealth products. It integrates with WooCommerce for e-commerce operations and uses Neon PostgreSQL as the database for SKU definitions and activity tracking.

## Key Architecture Decisions

### 1. Database as Source of Truth
- **Neon PostgreSQL** is the authoritative source for all SKU definitions
- Single SKUs and Combo SKUs are stored in the database, not static files
- Webhook validates line items against database records
- SKU Management UI allows adding/editing SKUs directly in the database (intentionally hidden from main navigation but still accessible)

### 2. Stock Updates Flow

#### Manual Updates (Procurement Tab)
- User manually updates stock via Procurement tab
- Updates both database (activity log) and WooCommerce stock
- Supports three operations:
  - **Manual Stock In** (`add`): Add quantity to existing stock
  - **Manual Stock Out** (`subtract`): Remove quantity from stock
  - **Reconciliation** (`set`): Set stock to specific quantity (requires notes)

#### Automatic Updates (Webhook)
- WooCommerce sends webhook when order status changes to `processing`
- Webhook validates line items against database
- Automatically updates WooCommerce stock for:
  - Single SKUs (direct deduction)
  - Combo SKUs (breaks down to components, deducts each)
- Then recalculates and updates combo SKU availability

#### Read-Only API Route
- `/api/inventory` route is **read-only**
- Fetches current stock from WooCommerce for display
- Does NOT update WooCommerce stock
- Used only for dashboard display

### 3. Removed Features
- **Recently Processed Orders** section has been removed
- No in-memory order tracking
- No order processing in `/api/inventory` route

## System Components

### Frontend (Next.js App Router)

#### Main Dashboard (`app/page.tsx`)
- Tab-based navigation:
  - **Dashboard**: Inventory overview
  - **Procurement**: Manual stock updates
  - **Activity Log**: View all system activities
  - **SKU Management**: (Admin only, intentionally hidden from main navigation but still accessible via direct route/state)
- Stock Take button (far right of navbar)
- Auto-refresh every 5 minutes
- User menu with logout

#### Components
- `InventoryDashboard.tsx`: Displays single SKU inventory (table format) and combo SKU availability
- `ProcurementUpdate.tsx`: Form for manual stock updates (add/subtract/set)
- `ActivityLog.tsx`: Table showing all system activities with filters
- `SkuManagement.tsx`: Admin interface for managing SKUs (intentionally hidden from main navigation)
- `StockTakeForm.tsx`: Form for entering physical counts during stock take
- `StockTakeReport.tsx`: View completed stock take reports

### Backend API Routes

#### `/api/inventory` (GET)
- **Purpose**: Read-only inventory display
- **Behavior**: Fetches fresh stock from WooCommerce
- **Returns**: Single SKU stock and combo SKU availability
- **Does NOT**: Update WooCommerce stock

#### `/api/webhooks/orders` (POST)
- **Purpose**: Handle WooCommerce order webhooks
- **Trigger**: When order status changes to `processing`
- **Validates**: Line items against database (not static files)
- **Updates WooCommerce**:
  1. Deducts single SKU stock
  2. Breaks down combo SKUs to components
  3. Deducts component stock
  4. Recalculates combo SKU availability
  5. Updates combo SKU stock in WooCommerce
- **Logs**: All updates to activity log

#### `/api/procurement/update` (POST)
- **Purpose**: Manual stock updates
- **Operations**: `add`, `subtract`, `set`
- **Updates**: Both database (activity log) and WooCommerce
- **Validation**: Notes required for Reconciliation (`set`)

#### `/api/stock-take/*`
- `POST /api/stock-take/create`: Create monthly stock take snapshot
- `GET /api/stock-take/current`: Get current month's stock take
- `POST /api/stock-take/[id]/complete`: Complete stock take and apply adjustments

#### `/api/activity-logs` (GET)
- **Purpose**: Fetch activity logs
- **Filters**: Date range, SKU
- **Returns**: All system activities (procurement, stock take, webhook)

#### `/api/skus/*`
- `GET/POST /api/skus/single`: Manage single SKUs
- `GET/POST /api/skus/combo`: Manage combo SKUs

### Database Schema (Neon PostgreSQL)

#### Core Tables
- `users`: User accounts (Google OAuth)
- `single_skus`: Single SKU definitions with WooCommerce product IDs
- `combo_skus`: Combo SKU definitions with component JSONB
- `procurement_updates`: Manual stock update records
- `activity_logs`: All system activities
- `stock_takes`: Monthly stock take snapshots
- `stock_take_items`: Physical counts and variances

#### Key Features
- Timezone set to GMT+8 (Asia/Kuala_Lumpur)
- All timestamps stored in GMT+8
- SKU definitions include WooCommerce product IDs for API sync

### Business Logic

#### Inventory Calculations (`lib/utils/inventory.ts`)
- `calculateAllComboAvailability()`: Calculate max available combo SKUs
- `deductComboSKU()`: Break down combo to components
- `deductSingleSKU()`: Direct single SKU deduction
- **Note**: `isSingleSKU()` and `isComboSKU()` still use static files for backward compatibility, but webhook uses database

#### WooCommerce Integration (`lib/services/woocommerce.ts`)
- `getProducts()`: Fetch products from WooCommerce
- `getOrders()`: Fetch orders (sorted by date, newest first)
- `getProduct()`: Get single product
- `updateProductStock()`: Update product stock quantity
- `createProduct()`: Create new product in WooCommerce

#### Database Queries (`lib/db/queries.ts`)
- All CRUD operations for database tables
- Activity logging
- Stock take operations
- SKU management

## Data Flow Diagrams

### Webhook Order Processing Flow

```
WooCommerce Order → Webhook Hit
    ↓
Validate Signature
    ↓
Check Order Status (must be 'processing')
    ↓
Get line_items from payload
    ↓
Fetch SKUs from Database (source of truth)
    ↓
For each line item:
  ├─ If single SKU in DB → Add to deductions
  └─ If combo SKU in DB → Break down to components → Add to deductions
    ↓
For each single SKU to deduct:
  ├─ Get current stock from WooCommerce
  ├─ Calculate new stock (current - deducted)
  └─ Update WooCommerce stock
    ↓
Recalculate affected combo SKUs:
  ├─ Fetch component stock from WooCommerce
  ├─ Calculate max available
  └─ Update combo SKU stock in WooCommerce
    ↓
Log activity to database
    ↓
Return success
```

### Manual Stock Update Flow

```
User enters stock update in Procurement tab
    ↓
Validate SKU exists in database
    ↓
Get current stock from WooCommerce
    ↓
Calculate new stock based on operation:
  ├─ add: current + quantity
  ├─ subtract: current - quantity
  └─ set: quantity (requires notes)
    ↓
Update WooCommerce stock
    ↓
Identify affected combo SKUs
    ↓
Recalculate combo availability
    ↓
Update combo SKU stock in WooCommerce
    ↓
Log to database (procurement_updates + activity_logs)
    ↓
Return success
```

### Stock Take Flow

```
User clicks "Start Stock Take"
    ↓
Create stock take snapshot:
  ├─ Fetch all single SKUs from database
  ├─ Get current stock from WooCommerce for each
  └─ Store snapshot in database
    ↓
User enters physical counts
    ↓
System calculates variance (physical - system)
    ↓
User provides remarks for items with variance
    ↓
Complete stock take:
  ├─ Apply adjustments to WooCommerce
  ├─ Create procurement_update records
  ├─ Log activities
  └─ Mark stock take as completed
    ↓
View stock take report
```

## File Structure

```
telehealth-inventory-management-system/
├── app/
│   ├── api/
│   │   ├── inventory/route.ts          # Read-only inventory API
│   │   ├── webhooks/orders/route.ts    # WooCommerce webhook handler
│   │   ├── procurement/update/route.ts # Manual stock updates
│   │   ├── stock-take/                 # Stock take endpoints
│   │   ├── activity-logs/route.ts     # Activity log API
│   │   └── skus/                       # SKU management API
│   ├── page.tsx                        # Main dashboard
│   └── stock-take/page.tsx             # Stock take page
├── components/
│   ├── InventoryDashboard.tsx         # Inventory display
│   ├── ProcurementUpdate.tsx           # Manual stock form
│   ├── ActivityLog.tsx                  # Activity log table
│   ├── SkuManagement.tsx               # SKU management UI
│   ├── StockTakeForm.tsx               # Stock take form
│   └── StockTakeReport.tsx              # Stock take report
├── lib/
│   ├── db/
│   │   ├── connection.ts               # Database connection (GMT+8)
│   │   └── queries.ts                  # Database queries
│   ├── services/
│   │   └── woocommerce.ts              # WooCommerce API client
│   └── utils/
│       ├── inventory.ts                # Inventory calculations
│       └── date.ts                      # Date/time utilities (GMT+8)
├── database/
│   ├── schema.sql                      # Database schema
│   ├── seed.sql                         # Initial data
│   └── migration_*.sql                  # Database migrations
└── types/
    └── inventory.ts                     # TypeScript types
```

## Environment Variables

Required environment variables:
- `DATABASE_URL`: Neon PostgreSQL connection string
- `NEXTAUTH_URL`: Application URL (for OAuth)
- `NEXTAUTH_SECRET`: NextAuth secret
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `WOOCOMMERCE_STORE_URL`: WooCommerce store URL
- `WOOCOMMERCE_CONSUMER_KEY`: WooCommerce API key
- `WOOCOMMERCE_CONSUMER_SECRET`: WooCommerce API secret
- `WOOCOMMERCE_WEBHOOK_SECRET`: Webhook signature secret

## Current Features

### ✅ Implemented
- Database-backed SKU management
- Webhook-based automatic stock updates
- Manual stock updates (Procurement tab)
- Stock Take feature (monthly snapshots)
- Activity Log with filters
- SKU Management (admin only, intentionally hidden from UI but still accessible)
- Google OAuth authentication
- Timezone handling (GMT+8)
- Combo SKU availability calculation
- Bidirectional WooCommerce sync

### ❌ Removed
- Recently Processed Orders section
- In-memory order tracking
- Order processing in `/api/inventory` route

### 🔄 Current Behavior
- **Webhook**: Updates WooCommerce stock automatically when orders processed
- **Manual Updates**: Updates WooCommerce stock via Procurement tab
- **API Route**: Read-only, fetches stock for display only
- **Database**: Source of truth for SKU definitions

## Important Notes

1. **Database is Source of Truth**: All SKU definitions come from database, not static files
2. **Webhook Validates Against Database**: Line items are checked against database records
3. **No Order Tracking**: System does not track processed orders in memory
4. **Stock Updates**: Only happen via webhook or manual procurement updates
5. **Timezone**: All timestamps are in GMT+8 (Asia/Kuala_Lumpur)
6. **Auto-Refresh**: Dashboard refreshes every 5 minutes (not 30 seconds)

## Testing Considerations

- Test webhook with orders containing only single SKUs
- Test webhook with orders containing only combo SKUs
- Test webhook with orders containing both
- Verify database validation works for new SKUs
- Verify stock updates reflect in WooCommerce
- Test stock take workflow end-to-end
- Verify timezone handling in all displays

