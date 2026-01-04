# HIS System - WRITE Actions Flowcharts

This document contains flowcharts for all WRITE actions (stock updates) made by the HIS system to WooCommerce.

## Overview

The HIS system writes to WooCommerce in the following scenarios:
1. **Order Webhook** - Process orders (deduct/restore stock for combo orders)
2. **Product Update Webhook** - Recalculate combo availability when WC updates single SKU
3. **Manual Stock Update** - Manual stock adjustments (procurement update or stock take)
4. **Direct Stock Update** - Direct stock update API (not used in UI)

**Note:** Flowcharts are combined where they share common patterns to reduce duplication.

---

## 1. Order Webhook (order.processing / order.cancelled / order.refunded)

**Trigger:** WooCommerce webhook `order.processing`, `order.cancelled`, or `order.refunded` event

```
┌─────────────────────────────────────────────────────────────┐
│ TRIGGER: WooCommerce Webhook                                 │
│ Event: order.processing / order.cancelled / order.refunded   │
│ Order Status: processing, cancelled, or refunded            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Verify Webhook Signature (HMAC SHA256)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Parse Order Payload                                       │
│    - Extract order ID, status, line items                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Check Order Status                                        │
│    ├─ Status = "processing"?                                 │
│    │  └─> Continue to Step 4 (Deduct flow)                   │
│    │                                                         │
│    └─ Status = "cancelled" or "refunded"?                    │
│       └─> Continue to Step 3a (Restore flow)                 │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌───────────────────┐   ┌─────────────────────────────────────┐
│ PROCESSING FLOW   │   │ CANCELLATION FLOW                   │
│                   │   │                                     │
│ 4. Identify Order │   │ 3a. Check Restoration Criteria       │
│    Type           │   │     ├─ Was in "processing"?         │
│    ├─ Single SKU? │   │     │  └─> Check webhook logs        │
│    │  └─> WC      │   │     │     If NO: Skip               │
│    │     handles  │   │     └─> Date after Jan 1, 2026?    │
│    │     (track   │   │        └─> Check date_created       │
│    │     only)    │   │           If NO: Skip                │
│    │              │   │                                     │
│    └─ Combo SKU?  │   │ 4a. Identify Order Type              │
│       └─> Step 5  │   │     ├─ Single SKU?                  │
│                   │   │     │  └─> WC handles (track only)   │
│ 5. Break Down     │   │     └─ Combo SKU?                   │
│    Combo to       │   │        └─> Step 5a                  │
│    Components     │   │                                     │
│                   │   │ 5a. Break Down Combo to Components  │
│ 6. WRITE: Deduct  │   │                                     │
│    Component      │   │ 6a. WRITE: Restore Component        │
│    Stocks         │   │     Stocks                          │
│    newStock =     │   │     newStock = currentStock + qty   │
│    currentStock   │   │     [HIS WRITE ACTION #1 or #3]     │
│    - quantity     │   │                                     │
│    [HIS WRITE     │   │                                     │
│     ACTION #1]    │   │                                     │
│                   │   │                                     │
└─────────┬─────────┘   └───────────────┬─────────────────────┘
          │                            │
          └────────────┬───────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Update Combo SKU Availability (Common Pattern)            │
│    → See "Common Pattern: Update Combo SKU Availability"     │
│    [HIS WRITE ACTION #2 or #4]                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Log to wc_webhook_logs                                    │
│    - Log component changes (deductions/restorations)         │
│    - Log combo updates                                       │
└─────────────────────────────────────────────────────────────┘
```

**WRITE Actions:**
- ✅ **Processing:** Deduct component single SKU stocks (combo orders) + Update combo availability
- ✅ **Cancellation:** Restore component single SKU stocks (combo orders) + Update combo availability

**Notes:**
- Single SKU orders: WooCommerce handles deduction/restoration automatically. HIS only tracks.
- Cancellation: Only restores if order was previously in "processing" status AND created after Jan 1, 2026.

---

## 3. Product Update Webhook (product.updated)

**Trigger:** WooCommerce webhook `product.updated` event

```
┌─────────────────────────────────────────────────────────────┐
│ TRIGGER: WooCommerce Webhook                                 │
│ Event: product.updated                                       │
│ When: Product stock updated in WC (reconciliation, etc.)      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Verify Webhook Signature (HMAC SHA256)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Parse Product Payload                                     │
│    - Extract product ID, SKU, stock_quantity                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Check if Product is Tracked Single SKU                   │
│    - Query database for single_skus                          │
│    - Match by woocommerce_product_id                         │
│    If NO: Skip (not a tracked SKU)                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Update Combo SKU Availability (Common Pattern)             │
│    → See "Common Pattern: Update Combo SKU Availability"     │
│    [HIS WRITE ACTION #5]                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Log to wc_webhook_logs                                    │
│    - Log product update event                                │
│    - Log combo updates                                       │
└─────────────────────────────────────────────────────────────┘
```

**WRITE Actions:**
- ✅ Update combo SKU availability

**Note:** Single SKU stock is updated by WooCommerce (not HIS). HIS only recalculates and updates combo SKUs.

---

## 2. Manual Stock Update (Procurement Update / Stock Take Completion)

**Trigger:** User action via UI

```
┌─────────────────────────────────────────────────────────────┐
│ TRIGGER: User Action                                         │
│ ├─ Procurement Update: POST /api/procurement/update          │
│ │  Operations: add, subtract, set                           │
│ └─ Stock Take: POST /api/stock-take/[id]/complete           │
│    When: Complete stock take reconciliation                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Authenticate User                                         │
│    - Check session/auth                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Validate & Prepare                                        │
│    ├─ Procurement Update:                                    │
│    │  ├─ Validate: SKU, quantity, operation                 │
│    │  ├─ Notes required for "set" operation                 │
│    │  └─ Validate SKU exists                                 │
│    │                                                         │
│    └─ Stock Take:                                            │
│       ├─ Get stock_take by ID                                │
│       └─ Get physical_counts (variance data)                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Calculate New Stock Quantity                              │
│    ├─ Procurement Update:                                    │
│    │  ├─ Fetch current stock from WC                        │
│    │  ├─ operation = "add" → newQty = current + qty         │
│    │  ├─ operation = "subtract" → newQty = current - qty    │
│    │  └─ operation = "set" → newQty = qty                   │
│    │                                                         │
│    └─ Stock Take:                                            │
│       └─ For each item with variance != 0:                   │
│          └─ newQty = physical_quantity                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. WRITE: Update Single SKU Stock                            │
│    └─ updateProductStock(productId, newQuantity)            │
│       [HIS WRITE ACTION #6 or #8]                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Log to Database                                           │
│    ├─ Procurement Update:                                    │
│    │  ├─ Create procurement_updates record                   │
│    │  └─ Create activity_logs entry                          │
│    │                                                         │
│    └─ Stock Take:                                            │
│       ├─ Create procurement_updates (operation: set)          │
│       ├─ Create activity_logs entry                         │
│       └─ Mark stock_take_item as adjusted                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Update Combo SKU Availability (Common Pattern)            │
│    → See "Common Pattern: Update Combo SKU Availability"     │
│    [HIS WRITE ACTION #7 or #9]                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Finalize                                                  │
│    ├─ Procurement Update:                                    │
│    │  └─ Return success response                             │
│    │                                                         │
│    └─ Stock Take:                                            │
│       └─ Mark stock_take as completed                        │
└─────────────────────────────────────────────────────────────┘
```

**WRITE Actions:**
- ✅ **Procurement Update:** Update single SKU stock (add/subtract/set) + Update combo availability
- ✅ **Stock Take:** Update single SKU stock to physical quantity + Update combo availability

---

## 4. Direct Stock Update (POST /api/stock/update)

**Trigger:** API call (direct stock update)

```
┌─────────────────────────────────────────────────────────────┐
│ TRIGGER: API Call                                            │
│ Endpoint: POST /api/stock/update                             │
│ Parameters: productId, stockQuantity                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Authenticate User                                         │
│    - Check session/auth                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Validate Request                                          │
│    - productId, stockQuantity required                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. WRITE: Update Product Stock Directly                      │
│    └─ updateProductStock(productId, stockQuantity)           │
│       [HIS WRITE ACTION #10]                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Return Success Response                                   │
│    - Return updated product info                             │
└─────────────────────────────────────────────────────────────┘
```

**WRITE Actions:**
- ✅ Update product stock directly

**Note:** This endpoint does NOT update combo SKUs automatically. It's a direct stock update.

---

## Common Pattern: Update Combo SKU Availability

This pattern is used by multiple flows after updating single SKU stocks:

```
┌─────────────────────────────────────────────────────────────┐
│ Update Combo SKU Availability Pattern                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Find Affected Combo SKUs                                  │
│    - Query all combo_skus from database                      │
│    - Find combos that use affected single SKU(s) as component│
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Build Stock Map                                           │
│    - Use updated stock for affected single SKU(s)            │
│    - Fetch current stock for other components                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Calculate Combo Availability                              │
│    For each affected combo:                                  │
│    - For each component: canMake = floor(stock/quantity)     │
│    - comboLimit = min(canMake) across all components         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. WRITE: Update Combo SKU Stock                             │
│    For each affected combo:                                  │
│    └─ updateProductStock(comboSKU, comboLimit)              │
└─────────────────────────────────────────────────────────────┘
```

**Used by:**
- Order Processing Webhook (after deducting components)
- Order Cancellation Webhook (after restoring components)
- Product Update Webhook (after WC updates single SKU)
- Manual Procurement Update (after updating single SKU)
- Stock Take Completion (after reconciling single SKUs)

---

## Common Pattern: Update Combo SKU Availability

This pattern is used by multiple flows after updating single SKU stocks:

```
┌─────────────────────────────────────────────────────────────┐
│ Update Combo SKU Availability Pattern                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Find Affected Combo SKUs                                  │
│    - Query all combo_skus from database                      │
│    - Find combos that use affected single SKU(s) as component│
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Build Stock Map                                           │
│    - Use updated stock for affected single SKU(s)            │
│    - Fetch current stock for other components                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Calculate Combo Availability                              │
│    For each affected combo:                                  │
│    - For each component: canMake = floor(stock/quantity)     │
│    - comboLimit = min(canMake) across all components         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. WRITE: Update Combo SKU Stock                             │
│    For each affected combo:                                  │
│    └─ updateProductStock(comboSKU, comboLimit)              │
└─────────────────────────────────────────────────────────────┘
```

**Used by:**
- Order Processing Webhook (after deducting components)
- Order Cancellation Webhook (after restoring components)
- Product Update Webhook (after WC updates single SKU)
- Manual Procurement Update (after updating single SKU)
- Stock Take Completion (after reconciling single SKUs)

---

## Summary of All HIS WRITE Actions

| # | Action | Trigger | What Gets Updated |
|---|--------|---------|-------------------|
| 1 | Deduct Component Stocks | `order.processing` webhook (combo orders) | Component single SKU stocks |
| 2 | Update Combo Availability | `order.processing` webhook | Combo SKU stocks |
| 3 | Restore Component Stocks | `order.cancelled/refunded` webhook (combo orders) | Component single SKU stocks |
| 4 | Update Combo Availability | `order.cancelled/refunded` webhook | Combo SKU stocks |
| 5 | Update Combo Availability | `product.updated` webhook | Combo SKU stocks |
| 6 | Update Single SKU Stock | Manual procurement update | Single SKU stock |
| 7 | Update Combo Availability | Manual procurement update | Combo SKU stocks |
| 8 | Update Single SKU Stock | Stock take completion | Single SKU stock (reconciliation) |
| 9 | Update Combo Availability | Stock take completion | Combo SKU stocks |
| 10 | Update Product Stock | Direct stock update API | Product stock (any) |

---

## Key Patterns

### Pattern 1: Combo SKU Updates
Almost all single SKU updates trigger combo SKU recalculation:
- After updating a single SKU, find all combos using it
- Fetch stock for all components
- Calculate availability: `min(floor(stock/quantity))`
- Update combo SKU stock in WooCommerce

### Pattern 2: Webhook Verification
All webhook-triggered writes:
1. Verify HMAC SHA256 signature
2. Parse payload
3. Validate data
4. Perform write action
5. Log to `wc_webhook_logs`

### Pattern 3: Authentication
All user-triggered writes:
1. Authenticate user session
2. Validate request
3. Perform write action
4. Log to database (procurement_updates, activity_logs)

---

## Notes

- **Single SKU Orders:** WooCommerce handles stock deduction/restoration automatically. HIS only tracks these changes.
- **Combo SKU Orders:** HIS system must handle component stock changes because WooCommerce doesn't know about combo breakdowns.
- **Combo Availability:** Always recalculated after any single SKU stock change to ensure accuracy.
- **Source of Truth:** WooCommerce is the source of truth for stock quantities. HIS reads from WC before making updates.

