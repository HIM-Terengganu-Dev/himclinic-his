# Quick Setup Guide

## 1. Install Dependencies

```bash
npm install
```

## 2. Configure Environment

Create a `.env` file in the root directory:

```env
WOOCOMMERCE_STORE_URL=https://forhimclinic.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxx
```

**Important**: Replace the `ck_xxx` and `cs_xxx` values with your actual WooCommerce API credentials.

### How to Get WooCommerce API Credentials

1. Log in to your WordPress admin panel
2. Go to **WooCommerce > Settings > Advanced > REST API**
3. Click **Add Key**
4. Set:
   - Description: "Inventory Management System"
   - User: Select your admin user
   - Permissions: **Read/Write**
5. Click **Generate API Key**
6. Copy the **Consumer Key** (ck_...) and **Consumer Secret** (cs_...)
7. Paste them into your `.env` file

## 3. Run Development Server

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## 4. Initial Setup

On first run, the system will:
- Initialize all single SKUs with 10 units each
- Calculate combo SKU availability based on components
- Be ready to process orders

## 5. Test the System

### Test Stock Dashboard
1. Open [http://localhost:3000](http://localhost:3000)
2. You should see all single SKUs with 10 units each
3. Combo SKU table shows calculated availability

### Test Order Processing
1. Go to "Process Orders" tab
2. Enter a valid WooCommerce order ID
3. Click "Process Order"
4. Stock will be deducted automatically

### Test Procurement Update
1. Go to "Procurement Update" tab
2. Select a single SKU (e.g., "him1")
3. Choose "Add" and enter quantity (e.g., 100)
4. Click "Update Stock"
5. See affected combo SKUs updated in WooCommerce

## Production Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import project to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Environment Variables for Production

```env
WOOCOMMERCE_STORE_URL=https://forhimclinic.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_BASE_URL=https://your-domain.vercel.app
```

## Common Issues

### Issue: "Failed to fetch products"
- Check WooCommerce credentials in `.env`
- Ensure API credentials have Read/Write permissions
- Verify store URL is correct (no trailing slash)

### Issue: "Order not found"
- Ensure order ID exists in WooCommerce
- Check order is not in "draft" status

### Issue: Stock not updating
- Restart development server after changing `.env`
- Check browser console for errors
- Verify network connection to WooCommerce store

## Next Steps

1. **Customize Initial Stock**: Edit `lib/utils/inventory.ts` line with `initializeInventory(10)` to change default quantity
2. **Add Database**: Implement PostgreSQL/MySQL for persistent storage
3. **Set Up Webhooks**: Configure WooCommerce webhooks to automatically process new orders
4. **Add Authentication**: Implement user authentication for multi-user access

## Support

Refer to full documentation in `README.md` for detailed information.




