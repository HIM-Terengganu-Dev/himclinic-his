# System Architecture Diagram

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TELEHEALTH INVENTORY SYSTEM                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────┐  ┌─────────────┐  ┌──────────────────┐         │
│  │   Dashboard   │  │   Orders    │  │   Procurement    │         │
│  │   Tab         │  │   Tab       │  │   Tab            │         │
│  └───────────────┘  └─────────────┘  └──────────────────┘         │
│         │                  │                    │                  │
│         │                  │                    │                  │
└─────────┼──────────────────┼────────────────────┼──────────────────┘
          │                  │                    │
          │ GET /api/        │ POST /api/         │ POST /api/
          │ inventory        │ orders/process     │ procurement/update
          │                  │                    │
┌─────────▼──────────────────▼────────────────────▼──────────────────┐
│                      API ROUTES (Next.js)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐     │
│  │  Inventory   │  │   Order      │  │   Procurement        │     │
│  │  API         │  │   Processor  │  │   Updater            │     │
│  └──────────────┘  └──────────────┘  └──────────────────────┘     │
│         │                  │                    │                  │
│         │                  │                    │                  │
└─────────┼──────────────────┼────────────────────┼──────────────────┘
          │                  │                    │
          │                  │                    │
          │             ┌────▼────┐          ┌────▼─────┐
          │             │ READ    │          │ WRITE    │
          │             │ Orders  │          │ Stock    │
          │             └────┬────┘          └────┬─────┘
          │                  │                    │
          │                  │                    │
┌─────────▼──────────────────▼────────────────────▼──────────────────┐
│                   BUSINESS LOGIC LAYER                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │           Inventory Calculation Engine                    │      │
│  │  - Calculate combo availability                          │      │
│  │  - Deduct single SKUs                                    │      │
│  │  - Deduct combo SKUs (break to components)              │      │
│  │  - Stock constraint validation                           │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐                        │
│  │  Single SKU      │  │  Combo SKU       │                        │
│  │  Definitions     │  │  Definitions     │                        │
│  │  (12 SKUs)       │  │  (18 SKUs)       │                        │
│  └──────────────────┘  └──────────────────┘                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
          │                  │                    │
          │                  │                    │
┌─────────▼──────────────────▼────────────────────▼──────────────────┐
│                      DATA LAYER                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────────────┐                                │
│  │   In-Memory Inventory Store    │                                │
│  │   (Single SKU Stock)           │                                │
│  │                                │                                │
│  │   him1: 10                     │                                │
│  │   spu1: 10                     │                                │
│  │   tad5/10tab: 10               │                                │
│  │   ...                          │                                │
│  └────────────────────────────────┘                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
          │                                        │
          │                                        │
          │ GET Products/Orders                    │ PUT Product Stock
          │ (READ)                                 │ (WRITE - Combos Only)
          │                                        │
┌─────────▼────────────────────────────────────────▼──────────────────┐
│                  WOOCOMMERCE REST API v3                            │
├─────────────────────────────────────────────────────────────────────┤
│  - Products Endpoint                                                │
│  - Orders Endpoint                                                  │
│  - Stock Update Endpoint (WRITE)                                    │
└─────────────────────────────────────────────────────────────────────┘
          │
          │
┌─────────▼─────────────────────────────────────────────────────────┐
│                    WOOCOMMERCE DATABASE                            │
│                   (forhimclinic.com)                               │
└────────────────────────────────────────────────────────────────────┘
```

## Order Processing Flow

```
┌────────────┐
│  Customer  │
│  Places    │
│  Order     │
└─────┬──────┘
      │
      ▼
┌─────────────────────┐
│  WooCommerce        │
│  Order Created      │
│  Order ID: 12345    │
└─────┬───────────────┘
      │
      │ (Manual Input)
      ▼
┌─────────────────────────────────────────────────┐
│  1. Fetch Order from WooCommerce (READ API)     │
│     GET /orders/12345                           │
│                                                 │
│     Returns:                                    │
│     - Order ID                                  │
│     - Line Items:                               │
│       * kom/spu+him × 2                         │
│       * him1 × 3                                │
└─────┬───────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│  2. Process Each Line Item                      │
│                                                 │
│     Item 1: kom/spu+him × 2                     │
│     → Combo SKU detected                        │
│     → Break down to components:                 │
│       - spu1: 2 units (1 × 2)                   │
│       - him1: 2 units (1 × 2)                   │
│                                                 │
│     Item 2: him1 × 3                            │
│     → Single SKU detected                       │
│     → Deduct directly:                          │
│       - him1: 3 units                           │
└─────┬───────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│  3. Calculate Total Deductions                  │
│                                                 │
│     Total to deduct:                            │
│     - spu1: 2 units                             │
│     - him1: 5 units (2 + 3)                     │
└─────┬───────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│  4. Validate Stock Availability                 │
│                                                 │
│     Current Inventory:                          │
│     - spu1: 10 units ✓ (enough)                 │
│     - him1: 10 units ✓ (enough)                 │
│                                                 │
│     If insufficient → Return error              │
│     If sufficient → Continue                    │
└─────┬───────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│  5. Update Inventory                            │
│                                                 │
│     New Inventory:                              │
│     - spu1: 8 units (10 - 2)                    │
│     - him1: 5 units (10 - 5)                    │
└─────┬───────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│  6. Recalculate Combo Availability              │
│                                                 │
│     kom/spu+him availability:                   │
│     - Component 1 (spu1): 8 / 1 = 8             │
│     - Component 2 (him1): 5 / 1 = 5             │
│     - Max available: min(8, 5) = 5 ✓            │
│     - Limiting component: him1                  │
└─────┬───────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────┐
│  7. Return Success      │
│     - Order processed   │
│     - Stock updated     │
│     - Dashboard refresh │
└─────────────────────────┘
```

## Procurement Update Flow

```
┌──────────────────┐
│  Procurement     │
│  Team Receives   │
│  New Stock       │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  1. Select Single SKU and Quantity               │
│                                                  │
│     SKU: him1                                    │
│     Operation: Add                               │
│     Quantity: 100                                │
└────────┬─────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  2. Update Local Inventory                       │
│                                                  │
│     Current: him1 = 5 units                      │
│     Add: 100 units                               │
│     New: him1 = 105 units                        │
└────────┬─────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  3. Identify Affected Combo SKUs                 │
│                                                  │
│     Combos using him1:                           │
│     - kom/spu+him (1× him1 + 1× spu1)            │
│     - kom/tad20+Him (1× him1 + 1× tad20/4tab)    │
│     - him3 (3× him1)                             │
│     - him9 (9× him1)                             │
└────────┬─────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  4. Calculate New Combo Availability             │
│                                                  │
│     kom/spu+him:                                 │
│     - him1: 105 / 1 = 105                        │
│     - spu1: 8 / 1 = 8                            │
│     - Max: min(105, 8) = 8 ← Limited by spu1     │
│                                                  │
│     him3:                                        │
│     - him1: 105 / 3 = 35                         │
│     - Max: 35                                    │
└────────┬─────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  5. Update WooCommerce Stock (WRITE API)         │
│                                                  │
│     For each affected combo:                     │
│     PUT /products/{id}                           │
│     { stock_quantity: calculated_max }           │
│                                                  │
│     - Product 7971 (kom/spu+him): 8              │
│     - Product 488 (him3): 35                     │
│     - Product 489 (him9): 11                     │
└────────┬─────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  6. Return Success                               │
│     - Single SKU updated locally                 │
│     - Combo SKUs updated in WooCommerce          │
│     - Dashboard shows new availability           │
└──────────────────────────────────────────────────┘
```

## SKU Relationship Diagram

```
Single SKUs (Base Components)
└─ him1 (HIM Coffee) ─────────┬─► kom/spu+him (1× him1 + 1× spu1)
                              ├─► kom/tad20+Him (1× him1 + 1× tad20/4tab)
                              ├─► him3 (3× him1)
                              └─► him9 (9× him1)

└─ spu1 (Spray Up) ───────────┬─► kom/spu+him (1× spu1 + 1× him1)
                              ├─► kom/spu+tad20 (1× spu1 + 1× tad20/4tab)
                              ├─► kom/spu+iqn50 (1× spu1 + 1× iqn50/4tab)
                              ├─► kom/spu+iqn100 (1× spu1 + 1× iqn100/4tab)
                              ├─► kom/spu+tra (1× spu1 + 1× tra/10tab)
                              ├─► spu3 (3× spu1)
                              ├─► spu5 (5× spu1)
                              └─► spu10 (10× spu1)

└─ tad5/10tab ────────────────┬─► kom/tad5+tad20 (1× tad5/10tab + 1× tad20/4tab)
                              ├─► kom/tad5(30tab)+tad20(4tab) (3× tad5/10tab + 1× tad20/4tab)
                              └─► tad5/30tab (3× tad5/10tab)

└─ tad20/4tab ────────────────┬─► kom/spu+tad20 (1× spu1 + 1× tad20/4tab)
                              ├─► kom/tad20+tra (1× tra/10tab + 1× tad20/4tab)
                              ├─► kom/tad20+Him (1× him1 + 1× tad20/4tab)
                              ├─► kom/tad5+tad20 (1× tad5/10tab + 1× tad20/4tab)
                              └─► kom/tad5(30tab)+tad20(4tab) (3× tad5/10tab + 1× tad20/4tab)

└─ iqn100/4tab ───────────────┬─► kom/spu+iqn100 (1× iqn100/4tab + 1× iqn100/4tab)
                              ├─► kom/iqn100+tra (1× tra/10tab + 1× iqn100/4tab)
                              └─► iqn100/12tab (3× iqn100/4tab)

└─ tra/10tab ─────────────────┬─► kom/spu+tra (1× spu1 + 1× tra/10tab)
                              ├─► kom/tad20+tra (1× tra/10tab + 1× tad20/4tab)
                              ├─► kom/iqn100+tra (1× tra/10tab + 1× iqn100/4tab)
                              └─► tra/30tab (3× tra/10tab)

└─ iqn50/4tab ────────────────┴─► kom/spu+iqn50 (1× spu1 + 1× iqn50/4tab)

[Other Single SKUs: via100/4tab, pri/6tab, spe/4tab, buku/BK, buku/SM]
```

## Component Interaction

```
┌────────────────────────────────────────────────────────────┐
│                     User Interface                         │
└────────────────────────────────────────────────────────────┘
  ↕ Props & State
┌────────────────────────────────────────────────────────────┐
│  React Components                                          │
│  - InventoryDashboard.tsx                                  │
│  - OrderProcessor.tsx                                      │
│  - ProcurementUpdate.tsx                                   │
└────────────────────────────────────────────────────────────┘
  ↕ HTTP Requests (fetch)
┌────────────────────────────────────────────────────────────┐
│  API Routes (Server-side)                                  │
│  - /api/inventory/route.ts                                 │
│  - /api/orders/process/route.ts                            │
│  - /api/procurement/update/route.ts                        │
└────────────────────────────────────────────────────────────┘
  ↕ Function Calls
┌────────────────────────────────────────────────────────────┐
│  Business Logic                                            │
│  - lib/utils/inventory.ts                                  │
│  - lib/services/woocommerce.ts                             │
└────────────────────────────────────────────────────────────┘
  ↕ Data Access
┌────────────────────────────────────────────────────────────┐
│  Data Layer                                                │
│  - lib/data/single-skus.ts                                 │
│  - lib/data/combo-skus.ts                                  │
│  - In-memory inventory store                               │
└────────────────────────────────────────────────────────────┘
  ↕ External API
┌────────────────────────────────────────────────────────────┐
│  WooCommerce REST API                                      │
│  - GET /products, /orders (READ)                           │
│  - PUT /products/{id} (WRITE)                              │
└────────────────────────────────────────────────────────────┘
```

