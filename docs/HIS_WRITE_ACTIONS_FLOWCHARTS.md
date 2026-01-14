# HIS System - WRITE Actions Flowcharts

This document contains flowcharts for all WRITE actions (stock updates) made by the HIS system to WooCommerce.

## Overview

The HIS system writes to WooCommerce in the following scenarios:
1. **Order Webhook** - Process orders (deduct/restore stock for combo orders)
2. **Product Update Webhook** - Recalculate combo availability when WC updates single SKU
3. **Manual Stock Update** - Manual stock adjustments (procurement update or stock take)
4. **Refund/Return** - Process refunds/returns with quality check (restore stock only if condition is 'good')
5. **Direct Stock Update** - Direct stock update API (not used in UI)

**Note:** Flowcharts are combined where they share common patterns to reduce duplication.

---

## 1. Order Webhook (order.processing / order.cancelled)

**Trigger:** WooCommerce webhook `order.processing` or `order.cancelled` event

**Note:** `order.refunded` events are NOT handled by this webhook. Refunded orders require manual quality check via the Refund/Return UI (see Section 5).

```
┌─────────────────────────────────────────────────────────────┐
│ TRIGGER: WooCommerce Webhook                                │
│ Event: order.processing / order.cancelled                   │
│ Order Status: processing or cancelled                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Verify Webhook Signature (HMAC SHA256)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Parse Order Payload                                      │
│    - Extract order ID, status, line items                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Check Order Status                                       │
│    ├─ Status = "processing"?                                │
│    │  └─> Continue to Step 4 (Deduct flow)                  │
│    │                                                        │
│    └─ Status = "cancelled"?                                 │
│       └─> Continue to Step 3a (Restore flow)                │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌───────────────────┐   ┌─────────────────────────────────────┐
│ PROCESSING FLOW   │   │ CANCELLATION FLOW                   │
│                   │   │                                     │
│ 4. Identify Order │   │ 3a. Check Restoration Criteria      │
│    Type           │   │     ├─ Was in "processing"?         │
│    ├─ Single SKU? │   │     │  └─> Check webhook logs       │
│    │  └─> WC      │   │     │     If NO: Skip               │
│    │     handles  │   │     └─> Date after Jan 1, 2026?     │
│    │     (track   │   │        └─> Check date_created       │
│    │     only)    │   │           If NO: Skip               │
│    │              │   │                                     │
│    └─ Combo SKU?  │   │ 4a. Identify Order Type             │
│       └─> Step 5  │   │     ├─ Single SKU?                  │
│                   │   │     │  └─> WC handles (track only)  │
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
          │                             │
          └────────────┬────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Update Combo SKU Availability (Common Pattern)           │
│    → See "Common Pattern: Update Combo SKU Availability"    │
│    [HIS WRITE ACTION #2 or #4]                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Log to wc_webhook_logs                                   │
│    - Log component changes (deductions/restorations)        │
│    - Log combo updates                                      │
└─────────────────────────────────────────────────────────────┘
```

**WRITE Actions:**
- ✅ **Processing:** Deduct component single SKU stocks (combo orders) + Update combo availability
- ✅ **Cancellation:** Restore component single SKU stocks (combo orders) + Update combo availability

**Notes:**
- **Single SKU orders:** WooCommerce handles deduction/restoration automatically. HIS only tracks these changes (marked as `isWcSide: true`, `hisWrote: false` in activity logs). They will show "(WC)" label in activity logs.
- **Combo SKU orders:** 
  - **Combo SKU format:** Combo SKUs are stored and processed as single strings (e.g., "kom/tad5(30tab)+tad20(4tab)"). The "+" character is part of the SKU string, NOT a separator. Do NOT split combo SKUs by "+".
  - **WooCommerce behavior:** WooCommerce does NOT deduct component stocks for combo SKUs because WC doesn't know about combo breakdowns. WC only sees the combo SKU as a single product and deducts the combo SKU stock itself.
  - **HIS responsibility:** HIS system must deduct ALL component stocks, even if a component is also a standalone single SKU that exists independently. HIS also recalculates and overwrites the combo SKU stock after component deductions.
  - **Component tracking:** All combo component deductions/restorations are marked as HIS-side (`isWcSide: false`, `hisWrote: true`), not WC-side. They will NOT show "(WC)" label in activity logs.
  - **Example:** When combo SKU "kom/tad5(30tab)+tad20(4tab)" is ordered:
    - WC deducts combo SKU stock (HIS will overwrite this later)
    - HIS deducts "tad5/10tab" (3x quantity) - marked as `hisWrote: true`
    - HIS deducts "tad20/4tab" (1x quantity) - marked as `hisWrote: true`, even though "tad20/4tab" exists as a standalone single SKU
    - HIS recalculates and updates combo SKU availability
- **Cancellation:** 
  - Only restores if order was previously in "processing" status AND created after Jan 1, 2026.
  - For combo orders: HIS restores component stocks (`hisWrote: true`).
  - For single SKU orders: WC restores automatically, HIS only tracks (`hisWrote: false`).
  - Only logs restorations if actual stock change occurred (`actualRestoredQty > 0`). No-change restorations (e.g., 80 → 80) are not logged.

---

## 4. Product Update Webhook (product.updated)

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

## 2. Refund/Return Processing

**Trigger:** User action via UI (POST /api/refund-return)

```
┌─────────────────────────────────────────────────────────────┐
│ TRIGGER: User Action                                        │
│ Endpoint: POST /api/refund-return                           │
│ Parameters: sku, quantity, condition, notes (optional),     │
│             orderId (optional)                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Authenticate User                                        │
│    - Check session/auth                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Validate Request                                         │
│    ├─ Validate: sku, quantity, condition required           │
│    ├─ Condition must be: 'good', 'damaged', or 'lost'       │
│    └─ Validate SKU exists                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Fetch Current Stock from WooCommerce                     │
│    - Get current stock quantity                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Check Condition                                          │
│    ├─ Condition = "good"?                                   │
│    │  └─> Continue to Step 5 (Restore stock)                │
│    │                                                        │
│    └─ Condition = "damaged" or "lost"?                      │
│       └─> Skip stock restoration, go to Step 6 (Log only)   │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌───────────────────┐   ┌─────────────────────────────────────┐
│ GOOD CONDITION    │   │ DAMAGED/LOST CONDITION              │
│                   │   │                                     │
│ 5. WRITE: Restore │   │ 6. Log Only (No Stock Change)       │
│    Stock          │   │    - Create procurement_updates     │
│    newQty =       │   │      (operation: 'set', no change)  │
│    current + qty  │   │    - Create activity_logs entry     │
│    [HIS WRITE     │   │    - Include returnCondition        │
│     ACTION #11]   │   │                                     │
│                   │   │                                     │
│ 6. Log to DB      │   │                                     │
│    - Create       │   │                                     │
│      procurement_ │   │                                     │
│      updates      │   │                                     │
│    - Create       │   │                                     │
│      activity_logs│   │                                     │
│    - Include      │   │                                     │
│      returnCondi- │   │                                     │
│      tion, orderId│   │                                     │
│                   │   │                                     │
└─────────┬─────────┘   └─────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Update Combo SKU Availability (Only if stock restored)   │
│    → See "Common Pattern: Update Combo SKU Availability"    │
│    [HIS WRITE ACTION #12]                                   │
│    Note: Skipped if condition is 'damaged' or 'lost'        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Return Success Response                                  │
│    - Include stockRestored flag                             │
│    - Include condition and message                          │
└─────────────────────────────────────────────────────────────┘
```

**WRITE Actions:**
- ✅ **Good Condition:** Restore single SKU stock + Update combo availability
- ⏭️ **Damaged/Lost Condition:** No stock restoration, only logging

**Notes:**
- **Condition-based logic:** Only 'good' condition items restore stock. 'damaged' and 'lost' items are logged but do not restore stock.
- **Order linking:** Optional `orderId` parameter links the refund/return to the original order in `wc_webhook_logs`.
- **Combo updates:** Combo SKU availability is only recalculated if stock was actually restored (good condition).

---

## 3. Manual Stock Update (Procurement Update / Stock Take Completion)

**Trigger:** User action via UI

```
┌─────────────────────────────────────────────────────────────┐
│ TRIGGER: User Action                                        │
│ ├─ Procurement Update: POST /api/procurement/update         │
│ │  Operations: add, subtract, set                           │
│ └─ Stock Take: POST /api/stock-take/[id]/complete           │
│    When: Complete stock take reconciliation                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Authenticate User                                        │
│    - Check session/auth                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Validate & Prepare                                       │
│    ├─ Procurement Update:                                   │
│    │  ├─ Validate: SKU, quantity, operation                 │
│    │  ├─ Notes required for "set" operation                 │
│    │  └─ Validate SKU exists                                │
│    │                                                        │
│    └─ Stock Take:                                           │
│       ├─ Get stock_take by ID                               │
│       └─ Get physical_counts (variance data)                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Calculate New Stock Quantity                             │
│    ├─ Procurement Update:                                   │
│    │  ├─ Fetch current stock from WC                        │
│    │  ├─ operation = "add" → newQty = current + qty         │
│    │  ├─ operation = "subtract" → newQty = current - qty    │
│    │  └─ operation = "set" → newQty = qty                   │
│    │                                                        │
│    └─ Stock Take:                                           │
│       └─ For each item with variance != 0:                  │
│          └─ newQty = physical_quantity                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. WRITE: Update Single SKU Stock                           │
│    └─ updateProductStock(productId, newQuantity)            │
│       [HIS WRITE ACTION #6 or #8]                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Log to Database                                          │
│    ├─ Procurement Update:                                   │
│    │  ├─ Create procurement_updates record                  │
│    │  └─ Create activity_logs entry                         │
│    │                                                        │
│    └─ Stock Take:                                           │
│       ├─ Create procurement_updates (operation: set)        │
│       ├─ Create activity_logs entry                         │
│       └─ Mark stock_take_item as adjusted                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Update Combo SKU Availability (Common Pattern)           │
│    → See "Common Pattern: Update Combo SKU Availability"    │
│    [HIS WRITE ACTION #7 or #9]                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Finalize                                                 │
│    ├─ Procurement Update:                                   │
│    │  └─ Return success response                            │
│    │                                                        │
│    └─ Stock Take:                                           │
│       └─ Mark stock_take as completed                       │
└─────────────────────────────────────────────────────────────┘
```

**WRITE Actions:**
- ✅ **Procurement Update:** Update single SKU stock (add/subtract/set) + Update combo availability
- ✅ **Stock Take:** Update single SKU stock to physical quantity + Update combo availability

---

## 5. Direct Stock Update (POST /api/stock/update)

**Trigger:** API call (direct stock update)

```
┌─────────────────────────────────────────────────────────────┐
│ TRIGGER: API Call                                           │
│ Endpoint: POST /api/stock/update                            │
│ Parameters: productId, stockQuantity                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Validate Request                                         │
│    - productId, stockQuantity required                      │
│    Note: No authentication required (direct API)            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. WRITE: Update Product Stock Directly                     │
│    └─ updateProductStock(productId, stockQuantity)          │
│       [HIS WRITE ACTION #10]                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Return Success Response                                  │
│    - Return updated product info                            │
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
│ Update Combo SKU Availability Pattern                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. Find Affected Combo SKUs                                  │
│    - Query all combo_skus from database                      │
│    - Find combos that use affected single SKU(s) as component│
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Build Stock Map                                          │
│    - Use updated stock for affected single SKU(s)           │
│    - Fetch current stock for other components               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Calculate Combo Availability                             │
│    For each affected combo:                                 │
│    - For each component: canMake = floor(stock/quantity)    │
│    - comboLimit = min(canMake) across all components        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. WRITE: Update Combo SKU Stock                            │
│    For each affected combo:                                 │
│    └─ updateProductStock(comboSKU, comboLimit)              │
└─────────────────────────────────────────────────────────────┘
```

**Used by:**
- Order Processing Webhook (after deducting components)
- Order Cancellation Webhook (after restoring components)
- Product Update Webhook (after WC updates single SKU)
- Manual Procurement Update (after updating single SKU)
- Stock Take Completion (after reconciling single SKUs)
- Refund/Return Processing (only if stock was restored - good condition)

---

## Summary of All HIS WRITE Actions

| # | Action | Trigger | What Gets Updated |
|---|--------|---------|-------------------|
| 1 | Deduct Component Stocks | `order.processing` webhook (combo orders) | Component single SKU stocks |
| 2 | Update Combo Availability | `order.processing` webhook | Combo SKU stocks |
| 3 | Restore Component Stocks | `order.cancelled` webhook (combo orders) | Component single SKU stocks |
| 4 | Update Combo Availability | `order.cancelled` webhook | Combo SKU stocks |
| 5 | Update Combo Availability | `product.updated` webhook | Combo SKU stocks |
| 6 | Update Single SKU Stock | Manual procurement update | Single SKU stock |
| 7 | Update Combo Availability | Manual procurement update | Combo SKU stocks |
| 8 | Update Single SKU Stock | Stock take completion | Single SKU stock (reconciliation) |
| 9 | Update Combo Availability | Stock take completion | Combo SKU stocks |
| 10 | Update Product Stock | Direct stock update API | Product stock (any) |
| 11 | Restore Single SKU Stock | Refund/Return (good condition only) | Single SKU stock |
| 12 | Update Combo Availability | Refund/Return (good condition only) | Combo SKU stocks |

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

- **Single SKU Orders:** WooCommerce handles stock deduction/restoration automatically. HIS only tracks these changes (marked as `isWcSide: true`, `hisWrote: false` in activity logs). They will show "(WC)" label in activity logs.
- **Combo SKU Orders:** 
  - Combo SKUs are stored and processed as single strings (e.g., "kom/tad5(30tab)+tad20(4tab)"). The "+" is part of the SKU string, not a separator.
  - WooCommerce does NOT deduct component stocks for combo SKUs because WC doesn't know about combo breakdowns. WC deducts the combo SKU stock itself, but HIS recalculates and overwrites this.
  - HIS system must handle ALL component stock changes, even if a component is also a standalone single SKU.
  - All combo component deductions/restorations are marked as HIS-side (`isWcSide: false`, `hisWrote: true`), not WC-side. They will NOT show "(WC)" label in activity logs.
  - Example: When "kom/tad5(30tab)+tad20(4tab)" is ordered, HIS deducts both "tad5/10tab" and "tad20/4tab" components, even though "tad20/4tab" exists independently as a single SKU.
- **Refund/Return:** 
  - Only 'good' condition items restore stock. 'damaged' and 'lost' items are logged but do not restore stock.
  - Combo SKU availability is only recalculated if stock was actually restored (good condition).
- **Combo Availability:** Always recalculated after any single SKU stock change to ensure accuracy (except for refund/return with damaged/lost condition).
- **Source of Truth:** WooCommerce is the source of truth for stock quantities. HIS reads from WC before making updates.
- **Logging:** Only logs restorations if actual stock change occurred (`actualRestoredQty > 0`). No-change restorations (e.g., 80 → 80) are not logged.

