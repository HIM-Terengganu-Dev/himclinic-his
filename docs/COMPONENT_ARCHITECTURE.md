# Component Architecture

## Overview

The frontend is built with Next.js 14 (App Router) using React Server Components and Client Components where needed.

## Project Structure

```
telehealth-inventory-management-system/
├── app/                          # Next.js App Router
│   ├── api/                      # API routes
│   │   ├── activity-logs/        # Activity log endpoints
│   │   ├── inventory/            # Inventory endpoints
│   │   ├── orders/               # Order endpoints
│   │   ├── procurement/           # Procurement endpoints
│   │   ├── skus/                  # SKU management endpoints
│   │   ├── webhooks/              # Webhook handlers
│   │   └── webhook-logs/          # Webhook log endpoints
│   ├── page.tsx                  # Main dashboard page
│   └── layout.tsx                # Root layout
├── components/                    # React components
│   ├── ActivityLog.tsx            # Activity log viewer
│   ├── AdminAccess.tsx            # Admin access control
│   ├── AuthProvider.tsx          # Authentication provider
│   ├── InventoryDashboard.tsx    # Main inventory display
│   ├── LoginPage.tsx             # Login page
│   ├── ProcurementUpdate.tsx     # Manual stock updates
│   ├── ReturnRefund.tsx          # Refund/return processing
│   └── SkuManagement.tsx          # SKU CRUD operations
├── lib/                          # Utility libraries
│   ├── auth/                     # Authentication
│   │   ├── config.ts             # NextAuth configuration
│   │   └── middleware.ts         # Auth middleware
│   ├── db/                       # Database layer
│   │   ├── connection.ts         # Database connection
│   │   └── queries.ts            # Database queries
│   ├── services/                 # External services
│   │   └── woocommerce.ts        # WooCommerce API client
│   └── utils/                    # Utility functions
│       ├── date.ts               # Date formatting
│       └── inventory.ts         # Inventory calculations
└── types/                        # TypeScript types
    └── inventory.ts              # Inventory type definitions
```

## Main Components

### `app/page.tsx` - Main Dashboard

**Purpose:** Main application entry point with tab navigation.

**Features:**
- Tab navigation (Dashboard, Procurement, Return/Refund, Activity, Admin, SKU Management)
- Session management
- Inventory data fetching
- State management for all 6 stock statuses

**State Management:**
```typescript
const [inWarehouseStock, setInWarehouseStock] = useState<Record<string, number>>({});
const [availableForPurchaseStock, setAvailableForPurchaseStock] = useState<Record<string, number>>({});
const [processingStock, setProcessingStock] = useState<Record<string, number>>({});
const [pendingConsultStock, setPendingConsultStock] = useState<Record<string, number>>({});
const [pendingReviewStock, setPendingReviewStock] = useState<Record<string, number>>({});
const [backOrderStock, setBackOrderStock] = useState<Record<string, number>>({});
```

### `components/InventoryDashboard.tsx`

**Purpose:** Display current inventory with all 6 statuses.

**Features:**
- Table view of all SKUs
- Columns for each status:
  - In Warehouse
  - Available for Purchase
  - Processing
  - Pending Consult
  - Pending Review
  - Backorder
- Combo SKU availability calculation
- Search and filter functionality
- Real-time data refresh

**Props:**
```typescript
interface InventoryDashboardProps {
  inventory: InventoryStock;
  comboAvailability: ComboAvailability[];
  inWarehouseStock: Record<string, number>;
  availableForPurchaseStock: Record<string, number>;
  processingStock: Record<string, number>;
  pendingConsultStock: Record<string, number>;
  pendingReviewStock: Record<string, number>;
  backOrderStock: Record<string, number>;
}
```

### `components/ActivityLog.tsx`

**Purpose:** Display activity logs from both HIS System and WooCommerce.

**Features:**
- Two tabs: "HIS System" and "Orders"
- Filtering by:
  - Type (order/product)
  - SKU
  - Date range
  - Order status
- Component deduction details for orders
- Pending stock calculations
- Export to CSV
- Pagination

**Key Functionality:**
- Filters duplicate order events (only first pending/processing per order)
- Ignores processing events that occur before pending (WC glitch handling)
- Displays all 6 status values for component deductions
- Shows pending stock from other orders

### `components/ProcurementUpdate.tsx`

**Purpose:** Manual stock updates (add, subtract, set).

**Features:**
- Operation selection (add/subtract/set)
- SKU selection
- Quantity input
- Notes field
- Real-time validation
- Success/error feedback

### `components/SkuManagement.tsx`

**Purpose:** CRUD operations for single and combo SKUs.

**Features:**
- Create/Update/Delete single SKUs
- Create/Update/Delete combo SKUs
- Component selection for combo SKUs
- WooCommerce product ID linking
- Validation

### `components/ReturnRefund.tsx`

**Purpose:** Process refunds and returns.

**Features:**
- Order ID input
- SKU selection
- Quantity input
- Reason field
- Stock restoration
- Activity logging

## Data Flow

### Inventory Data Flow

```
1. User opens dashboard
   ↓
2. app/page.tsx fetches from /api/inventory
   ↓
3. API queries getAllCurrentStock()
   ↓
4. Database returns current stock for all SKUs
   ↓
5. Frontend receives data and updates state
   ↓
6. InventoryDashboard renders with all 6 statuses
```

### Activity Log Data Flow

```
1. User opens Activity Log tab
   ↓
2. ActivityLog.tsx fetches from /api/activity-logs or /api/webhook-logs
   ↓
3. API queries database with filters
   ↓
4. For orders tab, fetches component deductions from /api/orders/[orderId]/component-deductions
   ↓
5. Frontend displays logs with filtering and pagination
```

## State Management

### Client-Side State

- React `useState` hooks for component state
- No global state management library (Redux, Zustand, etc.)
- Props drilling for shared state

### Server-Side State

- Database as source of truth
- API routes fetch fresh data on each request
- No caching layer (consider adding for performance)

## Styling

### Tailwind CSS

All components use Tailwind CSS for styling:
- Utility-first approach
- Responsive design
- Dark mode support (if needed)

### Icons

- Lucide React for all icons
- Consistent icon usage across components

## Authentication

### NextAuth.js

- Google OAuth integration
- Session management
- Role-based access control (admin/user)
- Protected routes via middleware

### Auth Flow

```
1. User clicks login
   ↓
2. Redirected to Google OAuth
   ↓
3. Google callback
   ↓
4. NextAuth creates session
   ↓
5. User redirected to dashboard
```

## Error Handling

### API Errors

- Try-catch blocks in API routes
- Error responses with status codes
- Error messages in response body

### Frontend Errors

- Error boundaries (consider adding)
- Try-catch in async functions
- User-friendly error messages
- Console logging for debugging

## Performance Considerations

### Current Optimizations

- Server-side rendering where possible
- Client components only when needed
- Efficient database queries with indexes

### Potential Improvements

- Add React Query for data caching
- Implement pagination for large datasets
- Add loading states and skeletons
- Optimize bundle size
- Add service worker for offline support

## Testing

Currently no automated tests. Consider adding:
- Unit tests for utility functions
- Integration tests for API routes
- E2E tests for critical flows
- Component tests for React components

## Related Documentation

- [System Overview](./SYSTEM_OVERVIEW.md) - Architecture overview
- [API Reference](./API_REFERENCE.md) - API endpoints
- [Development Guide](./DEVELOPMENT_GUIDE.md) - Setup and development
