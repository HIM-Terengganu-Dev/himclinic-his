# System Overview

## Architecture

The HIM Clinic Telehealth Inventory Management System is a Next.js application that serves as the **source of truth** for inventory management, integrating with WooCommerce for order processing.

### High-Level Architecture

```
┌─────────────────┐
│  WooCommerce    │
│  (Order Source) │
└────────┬────────┘
         │ Webhooks
         │ (order.processing, order.pending-consult, etc.)
         ▼
┌─────────────────────────────────────┐
│     Next.js Application             │
│  ┌──────────────────────────────┐  │
│  │  Webhook Handlers             │  │
│  │  - Process order status        │  │
│  │  - Update stock transactions   │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  API Routes                   │  │
│  │  - Inventory endpoints         │  │
│  │  - Stock management            │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  Frontend Components          │  │
│  │  - Dashboard                  │  │
│  │  - Activity Logs              │  │
│  └──────────────────────────────┘  │
└────────┬────────────────────────────┘
         │
         │ PostgreSQL Queries
         ▼
┌─────────────────┐
│   PostgreSQL    │
│   Database      │
│  - stock_       │
│    transactions │
│  - wc_webhook_  │
│    logs         │
│  - single_skus  │
│  - combo_skus   │
└─────────────────┘
```

## Core Principles

### 1. HIS System as Source of Truth

- **All stock deductions and restorations** are managed by the HIS system
- WooCommerce webhooks **trigger** stock changes but don't directly manage inventory
- Stock quantities are stored in PostgreSQL `stock_transactions` table
- The system tracks 6 distinct statuses for each SKU

### 2. Transaction-Based Stock Tracking

- Every stock change creates a `stock_transaction` record
- Each transaction stores before/after values for all 6 statuses
- Historical state can be reconstructed from transaction history
- Transactions are immutable (append-only)

### 3. Real-Time Webhook Processing

- WooCommerce sends webhooks for order status changes
- Webhooks are verified using HMAC SHA256 signatures
- Each webhook triggers appropriate stock status updates
- All webhook events are logged for audit purposes

## Data Flow

### Order Processing Flow

```
1. Order Created in WooCommerce
   ↓
2. Webhook: order.pending-consult (or order.pending-review)
   ↓
3. HIS System:
   - Increments pending-consult (or pending-review) count
   - Updates available_for_purchase (in_warehouse - pending - processing)
   - Calculates backorder if available = 0
   - Creates stock_transaction record
   ↓
4. Webhook: order.processing
   ↓
5. HIS System:
   - Moves quantity from pending-consult/review to processing
   - Updates available_for_purchase
   - Creates stock_transaction record
   ↓
6. Webhook: order.nv-pending-pickup
   ↓
7. HIS System:
   - Deducts from in_warehouse
   - Deducts from processing (or pending status)
   - Creates stock_transaction record
   ↓
8. Order Fulfilled (no webhook, stock already deducted)
```

### Stock Update Flow

```
1. User performs manual stock update
   ↓
2. API: POST /api/procurement/update
   ↓
3. HIS System:
   - Updates in_warehouse directly
   - Deducts from backorder if stock added
   - Updates available_for_purchase
   - Creates stock_transaction record
   - Logs to activity_logs
   ↓
4. Frontend refreshes inventory display
```

## Key Components

### Backend

- **API Routes** (`app/api/`): RESTful endpoints for inventory operations
- **Webhook Handlers** (`app/api/webhooks/`): Process WooCommerce webhooks
- **Database Layer** (`lib/db/queries.ts`): All database operations
- **WooCommerce Service** (`lib/services/woocommerce.ts`): WC API integration

### Frontend

- **Dashboard** (`components/InventoryDashboard.tsx`): Main inventory view
- **Activity Log** (`components/ActivityLog.tsx`): Audit trail viewer
- **Procurement Update** (`components/ProcurementUpdate.tsx`): Manual stock updates
- **SKU Management** (`components/SkuManagement.tsx`): SKU CRUD operations

### Database

- **stock_transactions**: All stock changes with 6-status tracking
- **wc_webhook_logs**: WooCommerce webhook events
- **activity_logs**: Manual system activities
- **single_skus**: Single SKU master data
- **combo_skus**: Combo SKU definitions

## Technology Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL (Neon)
- **Authentication**: NextAuth.js with Google OAuth
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **External API**: WooCommerce REST API

## Security

- **Webhook Verification**: HMAC SHA256 signature validation
- **Authentication**: Google OAuth with role-based access
- **Database**: Parameterized queries to prevent SQL injection
- **Environment Variables**: Sensitive data stored in `.env.local`

## Next Steps

- Read [Order Status System](./ORDER_STATUS_SYSTEM.md) for detailed status flow
- Review [Database Schema](./DATABASE_SCHEMA.md) for data structure
- Check [API Reference](./API_REFERENCE.md) for endpoint details
