# Refund/Return Handling Feature Plan

## Overview
This plan outlines the implementation of a dedicated **Refund/Return** tab/section, separate from the Procurement Update UI. This allows staff to manually QC returned items and restore stock based on condition (Lost/Damaged/Good) without confusing regular stock-in operations.

## Current State

### Refunded Orders Handling
- ✅ Refunded orders do NOT automatically restore stock (already implemented)
- ✅ Refunded orders do NOT log in Activity Log > WooCommerce (already implemented - they return early)
- ✅ Refunds will be handled manually via a dedicated Refund/Return UI

### Procurement Update UI
- Currently supports 3 operations:
  - `add` - Manual stock in (restocking, new inventory)
  - `subtract` - Manual stock out
  - `set` - Reconciliation (requires notes)
- Records stored in `procurement_updates` table
- Logged in `activity_logs` table
- **Will remain unchanged** - used only for regular procurement operations

## Requirements

### 1. Prevent Refunded Orders from Being Logged
**Status:** ✅ Already implemented
- Refunded orders return early without logging to `wc_webhook_logs`
- They will be handled manually via the new Refund/Return tab

### 2. Create Separate Refund/Return Tab/Component

#### Database Changes
**File:** `database/schema.sql` or new migration file

**Option 1: Add column to existing `procurement_updates` table (Recommended)**
```sql
ALTER TABLE inventory_management.procurement_updates
ADD COLUMN return_condition VARCHAR(20) CHECK (return_condition IN ('lost', 'damaged', 'good'));
```

**Rationale:**
- Reuse existing procurement_updates table structure
- Store return condition only for refund/return operations
- Allows tracking and reporting on refund/return conditions
- Separation is maintained at UI/API level, not database level

**Option 2: Create separate `refund_returns` table**
- More separation but requires duplicate structure
- More complex queries for reporting
- Not recommended unless there's a strong business case

**Decision:** Use Option 1 - Add column to `procurement_updates` table. The separation is maintained through the UI and business logic.

#### API Changes

**File:** `app/api/refund-return/route.ts` (NEW)

Create new API endpoint specifically for refund/return handling:
- POST `/api/refund-return` - Process refund/return stock in

**Request Body:**
```typescript
{
  sku: string;
  quantity: number;
  condition: 'lost' | 'damaged' | 'good';  // Required
  notes?: string;  // Optional
  orderId?: number;  // Optional: Link to original order
}
```

**Behavior:**
- Always uses `operation = 'add'` (stock in)
- Always requires `condition` field
- Stores condition in `return_condition` column
- Restores stock to WooCommerce (regardless of condition - condition is metadata)
- Logs to `procurement_updates` table with `return_condition` set
- Logs to `activity_logs` table with action `refund_return`
- Updates combo SKU availability

**Alternative:** Reuse `/api/procurement/update` with a flag?
- **Pros:** Less code duplication
- **Cons:** Mixes concerns, harder to maintain
- **Decision:** Create separate endpoint for clarity

**File:** `lib/db/queries.ts`

1. **Update `createProcurementUpdate` function signature:**
   ```typescript
   export async function createProcurementUpdate(data: {
       singleSkuId: number;
       operation: 'add' | 'subtract' | 'set';
       quantity: number;
       previousQuantity?: number;
       newQuantity?: number;
       notes?: string;
       returnCondition?: 'lost' | 'damaged' | 'good';  // NEW
       createdBy: number;
   })
   ```

2. **Update SQL INSERT statement:**
   - Include `return_condition` column
   - Pass `data.returnCondition || null`

3. **Update activity log details:**
   - Include `returnCondition` in the details JSON if provided
   - Use action `refund_return` when `returnCondition` is set

#### UI Changes

**File:** `components/ReturnRefund.tsx` (NEW)

Create new component for refund/return handling:

1. **Component Structure:**
   - Similar layout to `ProcurementUpdate.tsx`
   - Dedicated form for refund/return processing
   - Clear separation from procurement updates

2. **Form Fields:**
   - SKU selection (dropdown)
   - Quantity input
   - **Condition dropdown (Required):**
     - Good - Item is in good condition, restore stock
     - Damaged - Item is damaged (track but restore stock)
     - Lost - Item is lost (track but restore stock)
   - Notes (optional)
   - Order ID (optional - for linking to original order)

3. **UI Component Example:**
   ```tsx
   export default function ReturnRefund({ onStockUpdated }: { onStockUpdated: () => void }) {
     const [selectedSku, setSelectedSku] = useState('');
     const [quantity, setQuantity] = useState('');
     const [condition, setCondition] = useState<'lost' | 'damaged' | 'good' | ''>('');
     const [notes, setNotes] = useState('');
     const [orderId, setOrderId] = useState('');
     
     // ... rest of component
   }
   ```

4. **Form Validation:**
   - SKU: Required
   - Quantity: Required, must be > 0
   - Condition: Required (must select one)
   - Notes: Optional
   - Order ID: Optional

5. **Success Message:**
   - Show condition selected
   - Example: "Return processed successfully. Condition: Good. Stock restored."

**File:** `app/page.tsx`

1. **Add new tab to navigation:**
   ```typescript
   const [activeTab, setActiveTab] = useState<'dashboard' | 'procurement' | 'return-refund' | 'activity' | 'sku'>('dashboard');
   ```

2. **Add tab button:**
   ```tsx
   <button
     onClick={() => setActiveTab('return-refund')}
     className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all relative ${
       activeTab === 'return-refund'
         ? 'text-orange-600 bg-orange-50/50'
         : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
     }`}
   >
     <ArrowLeftCircle size={18} />  {/* or appropriate icon */}
     Refund/Return
     {activeTab === 'return-refund' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-orange-600" />}
   </button>
   ```

3. **Import and render component:**
   ```tsx
   import ReturnRefund from '@/components/ReturnRefund';
   
   {activeTab === 'return-refund' && (
     <ReturnRefund onStockUpdated={fetchInventory} />
   )}
   ```

#### Activity Log Display
**File:** `components/ActivityLog.tsx`

1. **Display return condition in activity log:**
   - In the "Details" column for refund/return operations
   - Format: Show condition badge/icon if `returnCondition` exists
   - Example: "Added 5 units (Return: Good)"
   - Filter for `action = 'refund_return'` or check `returnCondition` field

2. **Filter option (future enhancement):**
   - Add filter for return condition
   - Filter by: Good / Damaged / Lost / All
   - Only show when filtering refund/return operations

## Implementation Steps

### Phase 1: Database Schema Update
1. Create migration file: `database/migrations/add_return_condition_to_procurement.sql`
2. Add `return_condition` column to `procurement_updates` table
3. Run migration
4. Verify schema update

### Phase 2: Backend API Updates
1. Update `lib/db/queries.ts` - `createProcurementUpdate` function
   - Add `returnCondition` parameter
   - Update SQL INSERT statement
2. Create `app/api/refund-return/route.ts` - New endpoint
   - Validate request body
   - Process refund/return stock in
   - Log to procurement_updates with return_condition
   - Log to activity_logs with action 'refund_return'
   - Update combo SKU availability
3. Test API with different conditions

### Phase 3: Frontend UI Updates
1. Create `components/ReturnRefund.tsx`:
   - Copy structure from ProcurementUpdate.tsx
   - Modify for refund/return specific fields
   - Add condition dropdown (required)
   - Add order ID field (optional)
   - Update API call to use `/api/refund-return`
2. Update `app/page.tsx`:
   - Add 'return-refund' to activeTab type
   - Add new tab button in navigation
   - Import and render ReturnRefund component
3. Update `components/ActivityLog.tsx`:
   - Display return condition in activity log
   - Update details display for refund/return operations

### Phase 4: Testing & Documentation
1. Test scenarios:
   - Refund with "Good" condition
   - Refund with "Damaged" condition
   - Refund with "Lost" condition
   - Verify stock restoration (should always restore regardless of condition)
   - Verify activity log displays correctly
   - Verify procurement update UI is unchanged
   - Verify separation between tabs
2. Update documentation:
   - Update README.md
   - Update HIS_WRITE_ACTIONS_FLOWCHARTS.md
   - Add user guide for refund/return handling

## Decision Points

### 1. Stock Restoration Behavior for All Conditions
**Decision:** Always restore stock regardless of condition (Good/Damaged/Lost)

**Rationale:** 
- Physical inventory should match system inventory
- Condition is for reporting/audit purposes, not for stock calculation
- Damaged/Lost items are still physically in inventory (even if unusable)
- Staff can manually adjust if needed
- Simpler implementation

**Alternative:** Only restore if condition is "Good"
- **Pros:** More strict, prevents restoring unusable items
- **Cons:** Inventory count won't match physical stock
- **Decision:** Not chosen - prefer inventory accuracy

### 2. Database Structure
**Decision:** Add column to `procurement_updates` table (Option 1)

**Rationale:**
- Separation maintained at UI/API level
- Reuses existing structure
- Simpler queries for reporting
- Less code duplication

### 3. API Endpoint
**Decision:** Create separate `/api/refund-return` endpoint

**Rationale:**
- Clear separation of concerns
- Easier to maintain
- Different validation rules
- Different business logic
- Clearer API design

### 4. Condition Field Requirement
**Decision:** Required field in Refund/Return tab

**Rationale:**
- All refunds/returns must have a condition
- Ensures proper tracking
- Required for reporting/audit

## Future Enhancements

1. **Order Reference:**
   - Link refund/return to original order ID
   - Add `order_id` field to `procurement_updates` table (optional)
   - Allow searching refunds by order ID
   - Show order details in refund/return form

2. **Refund Report:**
   - Dashboard/report showing refunds by condition
   - Statistics: Good vs Damaged vs Lost rates
   - Filter by date range
   - Export to CSV

3. **Bulk Refund Handling:**
   - Allow processing multiple SKUs from a single order
   - Batch operation for refunds
   - Upload CSV for bulk processing

4. **Email Notifications:**
   - Notify when high damaged/lost rate detected
   - Weekly refund summary reports

5. **Integration with WooCommerce:**
   - Auto-populate refund form when order is refunded
   - Link refund records to WooCommerce refund records

## Files to Create/Modify

### New Files
- `components/ReturnRefund.tsx` - New component for refund/return UI
- `app/api/refund-return/route.ts` - New API endpoint
- `database/migrations/add_return_condition_to_procurement.sql` - Migration file

### Modified Files
- `app/page.tsx` - Add new tab and route
- `lib/db/queries.ts` - Update `createProcurementUpdate` function
- `components/ActivityLog.tsx` - Display return condition
- `database/schema.sql` - Document new column (if updating)

### Documentation
- `README.md` - Update refund/return handling section
- `docs/HIS_WRITE_ACTIONS_FLOWCHARTS.md` - Update flowcharts

## Testing Checklist

- [ ] Database migration runs successfully
- [ ] Refund with "Good" condition restores stock
- [ ] Refund with "Damaged" condition restores stock
- [ ] Refund with "Lost" condition restores stock
- [ ] Return condition appears in activity log
- [ ] Activity log shows correct action type
- [ ] Procurement Update UI is unchanged
- [ ] Tab navigation works correctly
- [ ] Form validation works (required fields)
- [ ] API validates condition field
- [ ] Combo SKU availability updates correctly
- [ ] Notes field works alongside condition
- [ ] Success messages display correctly
- [ ] Error handling works correctly
