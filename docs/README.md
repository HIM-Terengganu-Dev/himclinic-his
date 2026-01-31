# HIM Clinic Telehealth Inventory Management System - Documentation

## Table of Contents

1. [System Overview](./SYSTEM_OVERVIEW.md)
2. [Order Status System](./ORDER_STATUS_SYSTEM.md)
3. [Database Schema](./DATABASE_SCHEMA.md)
4. [API Reference](./API_REFERENCE.md)
5. [Webhook Integration](./WEBHOOK_INTEGRATION.md)
6. [Stock Management Flow](./STOCK_MANAGEMENT_FLOW.md)
7. [Component Architecture](./COMPONENT_ARCHITECTURE.md)
8. [Development Guide](./DEVELOPMENT_GUIDE.md)

## Quick Start

This is a Next.js-based inventory management system that integrates with WooCommerce to manage inventory for HIM Clinic Telehealth. The system tracks stock across 6 distinct statuses and provides real-time synchronization with WooCommerce.

### Key Features

- ✅ **6-Status Order Tracking**: in warehouse, available for purchase, processing, pending-consult, pending-review, backorder
- ✅ **Single & Combo SKU Management**: Track individual products and combo products
- ✅ **Real-time Webhook Sync**: Automatic synchronization with WooCommerce
- ✅ **Manual Stock Updates**: Procurement updates, stock in/out, reconciliations
- ✅ **Comprehensive Activity Logging**: Separate logs for HIS System and WooCommerce events
- ✅ **Stock Take Management**: Physical inventory counting and variance tracking
- ✅ **User Authentication**: Google OAuth with role-based access

## Documentation Files

- **[System Overview](./SYSTEM_OVERVIEW.md)**: High-level architecture and data flow
- **[Order Status System](./ORDER_STATUS_SYSTEM.md)**: Detailed explanation of the 6-status system
- **[Database Schema](./DATABASE_SCHEMA.md)**: Complete database structure and relationships
- **[API Reference](./API_REFERENCE.md)**: All API endpoints and their usage
- **[Webhook Integration](./WEBHOOK_INTEGRATION.md)**: WooCommerce webhook handling
- **[Stock Management Flow](./STOCK_MANAGEMENT_FLOW.md)**: How stock moves through the system
- **[Component Architecture](./COMPONENT_ARCHITECTURE.md)**: Frontend component structure
- **[Development Guide](./DEVELOPMENT_GUIDE.md)**: Setup, development, and deployment

## Getting Started

1. Read [System Overview](./SYSTEM_OVERVIEW.md) for architecture understanding
2. Review [Order Status System](./ORDER_STATUS_SYSTEM.md) for status flow
3. Check [Development Guide](./DEVELOPMENT_GUIDE.md) for setup instructions
