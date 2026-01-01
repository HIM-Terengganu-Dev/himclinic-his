# Telehealth Inventory Management System

A Next.js-based inventory management system that integrates with WooCommerce to manage single SKUs, combo SKUs, and real-time stock synchronization.

## Overview

This system provides a **bidirectional sync** between WooCommerce (source of truth for inventory) and a PostgreSQL database that stores SKU definitions, user data, and activity logs.

### Key Features

- ✅ **Single SKU Management**: Track individual products with their WooCommerce product IDs
- ✅ **Combo SKU Management**: Define combo products made from multiple single SKUs
- ✅ **Real-time Inventory Sync**: Automatic synchronization with WooCommerce via webhooks
- ✅ **Manual Stock Updates**: Procurement updates, stock in/out, and reconciliations
- ✅ **Activity Logging**: Separate logs for HIS System activities and WooCommerce webhook events
- ✅ **Combo Availability Calculation**: Automatic calculation of combo SKU availability based on component stocks
- ✅ **Stock Take Management**: Physical inventory counting and variance tracking
- ✅ **User Authentication**: Google OAuth integration with role-based access (admin/user)

## Architecture

### Data Flow

```
WooCommerce (Source of Truth)
    ↕ (Webhooks + REST API)
Next.js System
    ↕ (PostgreSQL)
Database (SKU Definitions, Users, Logs)
```

### Source of Truth

- **Inventory Quantities**: Stored in WooCommerce, fetched in real-time
- **SKU Definitions**: Stored in PostgreSQL (single_skus, combo_skus tables)
- **User Data**: Stored in PostgreSQL (users table)
- **Activity Logs**: Stored in PostgreSQL (activity_logs, wc_webhook_logs tables)

## Database Schema

The system uses PostgreSQL with the `inventory_management` schema containing 6 tables:

1. **users** - Google OAuth user authentication
2. **single_skus** - Master data for single SKU products
3. **combo_skus** - Combo SKU definitions with components
4. **procurement_updates** - History of manual stock updates
5. **activity_logs** - Audit trail of manual system changes (HIS System tab)
6. **wc_webhook_logs** - WooCommerce webhook events (WooCommerce tab)

For detailed database setup instructions, see [database/README.md](database/README.md).

## WooCommerce Webhooks

The system listens to WooCommerce webhooks to automatically sync inventory changes:

### Product Webhook (`/api/webhooks/products`)

**Event:** `product.updated`

**Trigger:** When a product's stock is updated in WooCommerce (reconciliation, manual change, etc.)

**Behavior:**
1. Verifies webhook signature using HMAC SHA256
2. Identifies if the updated product is a tracked single SKU
3. Finds all combo SKUs that use this single SKU as a component
4. Recalculates combo SKU availability based on current component stocks
5. Updates combo SKU stock quantities back to WooCommerce
6. Logs the event to `wc_webhook_logs` table

### Order Webhook (`/api/webhooks/orders`)

**Event:** `order.processing` (paid orders ready for fulfillment)

**Behavior:**
1. Verifies webhook signature using HMAC SHA256
2. Processes only orders with `processing` status
3. For combo SKU orders:
   - Deducts component single SKU stocks in WooCommerce
   - Recalculates affected combo SKU availability
   - Updates combo SKUs back to WooCommerce
4. For single SKU orders:
   - WooCommerce handles stock deduction automatically
   - System recalculates and updates affected combo SKUs
5. Logs all details (component deductions, combo updates) to `wc_webhook_logs` table

### Webhook Security

All webhooks are protected with HMAC SHA256 signature verification using the `WOOCOMMERCE_WEBHOOK_SECRET` environment variable.

## API Endpoints

### Inventory

- `GET /api/inventory` - Fetch current inventory (single SKUs + combo availability)
- `POST /api/procurement/update` - Manual stock update (add/subtract/set)
- `POST /api/stock/update` - Update stock for a single SKU

### SKUs

- `GET /api/skus/single` - List all single SKUs
- `POST /api/skus/single` - Create a single SKU
- `PUT /api/skus/single` - Update a single SKU
- `GET /api/skus/combo` - List all combo SKUs
- `POST /api/skus/combo` - Create a combo SKU
- `PUT /api/skus/combo` - Update a combo SKU

### Activity Logs

- `GET /api/activity-logs` - Fetch HIS System activity logs (manual changes)
- `GET /api/webhook-logs` - Fetch WooCommerce webhook logs

### Webhooks

- `POST /api/webhooks/products` - Handle WooCommerce product webhooks
- `POST /api/webhooks/orders` - Handle WooCommerce order webhooks

### Stock Take

- `GET /api/stock-take/current` - Get current active stock take
- `POST /api/stock-take/create` - Create a new stock take
- `POST /api/stock-take/[id]/complete` - Complete a stock take

## Environment Variables

Create a `.env.local` file with the following variables:

```env
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# WooCommerce
WOOCOMMERCE_URL=https://your-store.com
WOOCOMMERCE_CONSUMER_KEY=your-consumer-key
WOOCOMMERCE_CONSUMER_SECRET=your-consumer-secret
WOOCOMMERCE_WEBHOOK_SECRET=your-webhook-secret
```

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd telehealth-inventory-management-system
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up the database**
   ```bash
   # See database/README.md for detailed instructions
   psql 'your-connection-string' -f database/schema.sql
   psql 'your-connection-string' -f database/seed.sql
   psql 'your-connection-string' -f database/migration_wc_webhook_logs.sql
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Set up WooCommerce webhooks**

   In your WooCommerce admin:
   - Go to Settings → Advanced → Webhooks
   - Create webhook for `order.updated` → `POST /api/webhooks/orders`
   - Create webhook for `product.updated` → `POST /api/webhooks/products`
   - Use the same secret from `WOOCOMMERCE_WEBHOOK_SECRET` for both

## Activity Log Tabs

The Activity Log page has two tabs:

### HIS System Tab

Shows all manual activities performed by users through the system:
- Manual Stock In (add)
- Manual Stock Out (subtract)
- Reconciliation (set)
- SKU creation/updates
- Other system activities

### WooCommerce Tab

Shows all stock changes triggered from WooCommerce:
- Order processing (with component deductions for combo SKUs)
- Product stock updates/reconciliations
- Combo SKU recalculations
- All webhook events with full details

## Combo SKU Calculation

Combo SKU availability is calculated based on the limiting component:

```javascript
// For each combo SKU
const comboLimit = Math.min(
  ...components.map(comp => 
    Math.floor(singleSkuStock[comp.sku] / comp.quantity)
  )
);
```

**Example:**
- Combo SKU requires: 2x HIM1, 3x SPU1
- Available stock: HIM1 = 10, SPU1 = 15
- Calculation: min(10/2, 15/3) = min(5, 5) = **5 units available**

## Stock Take Process

1. Create a stock take session
2. Record physical quantities for each single SKU
3. System calculates variance (physical vs system)
4. Complete stock take to finalize adjustments
5. Adjustments are applied to WooCommerce

## User Roles

- **admin**: Can manage SKUs, update stock, view all activity logs
- **user**: Can update stock, view activity logs

To promote a user to admin:
```sql
UPDATE inventory_management.users 
SET role = 'admin' 
WHERE email = 'user@example.com';
```

## Development

### Project Structure

```
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   ├── webhooks/      # WooCommerce webhook handlers
│   │   ├── inventory/     # Inventory endpoints
│   │   └── activity-logs/ # Activity log endpoints
│   └── page.tsx           # Main dashboard
├── components/            # React components
│   ├── ActivityLog.tsx    # Activity log with tabs
│   ├── InventoryDashboard.tsx
│   └── ProcurementUpdate.tsx
├── lib/
│   ├── db/               # Database queries
│   ├── services/         # External services (WooCommerce)
│   └── utils/            # Utility functions
└── database/             # Database migrations and setup
```

### Key Functions

- `logWcWebhook()` - Log WooCommerce webhook events
- `getWcWebhookLogs()` - Retrieve webhook logs with filters
- `logActivity()` - Log manual system activities
- `calculateAllComboAvailability()` - Calculate combo SKU availability
- `updateProductStock()` - Update stock in WooCommerce

## Troubleshooting

### Webhooks Not Working

1. Verify `WOOCOMMERCE_WEBHOOK_SECRET` matches in both systems
2. Check webhook URLs are publicly accessible
3. Review server logs for signature verification errors
4. Ensure WooCommerce can reach your webhook endpoints

### Inventory Not Syncing

1. Verify WooCommerce API credentials
2. Check product IDs match between database and WooCommerce
3. Review webhook logs in the "WooCommerce" tab
4. Ensure combo SKU components are correctly defined

### Database Connection Issues

See [database/README.md](database/README.md) for troubleshooting database issues.

## License

[Add your license here]

## Support

For issues or questions, please contact the development team.

