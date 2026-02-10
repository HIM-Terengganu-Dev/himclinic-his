# HIM Clinic Inventory Management System - Documentation

## 📋 Overview

The HIM Clinic Inventory Management System is a web-based application that helps manage product inventory, track stock levels, and automatically sync with WooCommerce. It provides real-time stock monitoring, low stock alerts, and comprehensive activity logs.

---

## 🎯 What This System Does

### For Business Users

1. **Track Inventory** - Monitor stock levels for all products in real-time
2. **Manage Products** - Create and manage single products and combo packages
3. **Stock Updates** - Manually add, subtract, or set stock quantities
4. **Low Stock Alerts** - Receive email notifications when products run low
5. **Activity Tracking** - View all inventory changes and who made them
6. **WooCommerce Sync** - Automatically sync stock with your online store

---

## 🔄 System Flow

### High-Level Overview

```
┌─────────────────┐
│  WooCommerce    │
│  (Online Store) │
└────────┬────────┘
         │
         │ Webhooks (Order/Product Updates)
         │
         ▼
┌─────────────────┐
│   HIS System    │
│  (This App)     │
│                 │
│  • Dashboard    │
│  • SKU Mgmt     │
│  • Stock Updates│
│  • Activity Log │
└────────┬────────┘
         │
         │ Stock Sync
         │
         ▼
┌─────────────────┐
│   Database      │
│  (PostgreSQL)   │
│                 │
│  • SKU Data     │
│  • Stock Levels │
│  • Transactions │
│  • Activity Logs│
└─────────────────┘
```

---

## 📊 Main Features

### 1. Dashboard
**Purpose:** Quick overview of all inventory

**What you see:**
- Current stock levels for all products
- Low stock warnings (red/yellow indicators)
- Summary of out-of-stock and low-stock items
- Color coding:
  - 🔴 Red = Out of stock (0 units)
  - 🟡 Yellow = Low stock (below threshold)
  - 🟢 Green = Normal stock

**Key Actions:**
- View all products at a glance
- Identify items needing restocking

---

### 2. SKU Management
**Purpose:** Create and manage products

**Single SKU:**
- Individual products (e.g., "HIM Coffee", "SPU Supplement")
- Each has its own stock count
- Automatically creates product in WooCommerce

**Combo SKU:**
- Packages made from multiple single SKUs
- Example: "HIM + SPU Combo" = 1 HIM + 1 SPU
- Stock calculated automatically from components

**Key Actions:**
- Create new products
- Edit product details
- Set low stock thresholds
- Enable/disable email alerts per product
- Hide/show products
- Delete products (also removes from WooCommerce)

**Workflow:**
```
Create SKU
    │
    ├─► Enter: Name, SKU Code, Description
    │
    ├─► Set: Initial Stock Count
    │
    └─► System automatically:
        ├─► Creates product in WooCommerce
        ├─► Links WooCommerce Product ID
        └─► Initializes stock in database
```

---

### 3. Stock Updates (Procurement)
**Purpose:** Manually adjust inventory

**Operations:**
- **Add** - Increase stock (new shipment received)
- **Subtract** - Decrease stock (damaged, lost, etc.)
- **Set** - Set exact count (physical count/reconciliation)

**Workflow:**
```
Stock Update
    │
    ├─► Select SKU
    ├─► Choose Operation (Add/Subtract/Set)
    ├─► Enter Quantity
    ├─► Add Notes (optional)
    │
    └─► System automatically:
        ├─► Updates database
        ├─► Syncs to WooCommerce
        └─► Logs activity
```

**Important Notes:**
- All changes are logged with timestamp and user
- Stock syncs to WooCommerce immediately
- Notes appear in Activity Log

---

### 4. Activity Log
**Purpose:** Track all inventory changes

**Two Tabs:**

**HIS System Tab:**
- Manual stock updates
- SKU creation/edits
- User actions in the system

**WooCommerce Tab:**
- Order processing
- Order cancellations
- Product updates from WooCommerce

**Key Features:**
- Filter by SKU, date, user, or event type
- View detailed information for each change
- See who made changes and when

---

### 5. Low Stock Alerts
**Purpose:** Get notified when products run low

**How It Works:**
```
Stock Level Changes
    │
    ├─► System checks if below threshold
    │
    ├─► If low stock detected:
    │   ├─► Checks if alerts enabled for SKU
    │   ├─► Checks if email alerts enabled globally
    │   └─► Sends email to configured recipients
    │
    └─► Email includes:
        ├─► SKU code and name
        ├─► Current stock level
        └─► Threshold setting
```

**Configuration:**
- Set threshold per SKU in SKU Management
- Enable/disable alerts per SKU
- Configure recipient emails in settings
- Default sender: admin@forhimclinic.com

---

## 🔐 User Roles

### Admin
- Full access to all features
- Can manage users
- Can configure system settings
- Can view all activity logs

### Developer
- Same as Admin
- Additional technical access

### Staff
- View inventory
- View activity logs
- Limited editing capabilities

---

## 🔄 WooCommerce Integration

### Automatic Sync Flow

```
WooCommerce Event
    │
    ├─► Order Created/Updated
    │   └─► Stock automatically deducted
    │
    ├─► Order Cancelled
    │   └─► Stock automatically restored
    │
    ├─► Product Updated
    │   └─► Combo SKU availability recalculated
    │
    └─► All changes logged in Activity Log
```

### Bidirectional Sync
- **HIS → WooCommerce:** Manual stock updates sync to WooCommerce
- **WooCommerce → HIS:** Order events update stock in HIS
- **Real-time:** Changes reflect immediately in both systems

---

## 📧 Email Alerts Setup

### Prerequisites
1. Domain verified in Resend.com (forhimclinic.com)
2. Resend API key configured
3. Recipient emails configured

### Configuration Flow
```
Enable Email Alerts
    │
    ├─► Set low stock threshold per SKU
    ├─► Enable email alerts for specific SKUs
    ├─► Configure recipient emails
    │
    └─► System automatically sends when:
        ├─► Stock falls below threshold
        └─► Alerts are enabled for that SKU
```

---

## 🗄️ Data Storage

### What Gets Stored
- **SKU Definitions:** Product names, codes, descriptions
- **Stock Levels:** Current quantities in warehouse
- **Transactions:** Every stock change (add/subtract/set)
- **Activity Logs:** All user actions and system events
- **User Accounts:** Login information and roles

### Data Flow
```
User Action / WooCommerce Event
    │
    ├─► Creates Transaction Record
    ├─► Updates Current Stock
    ├─► Logs Activity
    │
    └─► Syncs to WooCommerce (if applicable)
```

---

## 🚀 Getting Started (For Users)

### First Time Setup
1. **Login** - Use Google account (admin access required)
2. **View Dashboard** - See current inventory status
3. **Create SKUs** - Add your products
4. **Set Thresholds** - Configure low stock alerts
5. **Configure Email** - Set up recipient addresses

### Daily Operations
1. **Check Dashboard** - Review stock levels
2. **Update Stock** - Record new shipments or adjustments
3. **Review Activity Log** - Monitor all changes
4. **Respond to Alerts** - Restock items when notified

---

## 🔧 Technical Overview (For Developers)

### Architecture
- **Frontend:** Next.js 14 (React)
- **Backend:** Next.js API Routes
- **Database:** PostgreSQL
- **Authentication:** NextAuth.js (Google OAuth)
- **Email:** Resend.com
- **External API:** WooCommerce REST API

### Key Technologies
- TypeScript for type safety
- PostgreSQL for data persistence
- Webhooks for real-time sync
- Server-side rendering for performance

### API Endpoints
- `/api/inventory` - Get current stock
- `/api/skus/*` - SKU management
- `/api/procurement/update` - Stock updates
- `/api/webhooks/*` - WooCommerce webhooks
- `/api/low-stock/*` - Email alert management

### Database Schema
- `single_skus` - Single product definitions
- `combo_skus` - Combo product definitions
- `stock_transactions` - All stock changes
- `activity_logs` - User actions
- `wc_webhook_logs` - WooCommerce events

---

## ⚠️ Important Notes

### For Business Users
1. **Stock is Source of Truth:** Database is the primary source, WooCommerce syncs from it
2. **All Changes are Logged:** Every action is recorded with user and timestamp
3. **Combo SKUs:** Stock is calculated from components, not stored separately
4. **Email Alerts:** Require domain verification in Resend.com
5. **SKU Deletion:** Removes product from both HIS and WooCommerce

### For Developers
1. **Environment Variables:** Required for database, auth, and external APIs
2. **Webhook Security:** HMAC SHA256 signature verification
3. **Atomic Operations:** SKU creation/deletion ensures both systems stay in sync
4. **Error Handling:** Graceful fallbacks for WooCommerce API failures
5. **Timezone:** All timestamps in GMT+8 (Asia/Kuala_Lumpur)

---

## 📞 Support

### Common Issues
- **Can't login:** Check Google OAuth configuration
- **Stock not syncing:** Verify WooCommerce webhook settings
- **Emails not sending:** Check Resend domain verification
- **SKU not appearing:** Verify WooCommerce product ID

### Getting Help
- Check Activity Log for error details
- Review WooCommerce webhook logs
- Verify environment variables are set correctly

---

## 📝 Version History

- **Current Version:** 1.0.0
- **Last Updated:** February 2026
- **Features:** Real-time sync, email alerts, combo SKU management

---

*This documentation is designed to be clear and accessible. For detailed technical specifications, refer to the codebase or contact the development team.*
