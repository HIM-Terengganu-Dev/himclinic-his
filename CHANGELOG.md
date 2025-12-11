# System Updates - Version 1.1.0

## 🆕 New Features

### 1. Real-Time Auto-Refresh
The dashboard now automatically refreshes every 30 seconds to catch changes from WooCommerce or other sources.

**How it works:**
- Auto-refresh is ON by default
- Updates every 30 seconds in the background
- Toggle ON/OFF with the new button in header
- Green pulsing dot indicates auto-refresh is active

**Benefits:**
- If an order is processed in WooCommerce, you'll see the change within 30 seconds
- Multiple users can work simultaneously - changes sync automatically
- No need to manually refresh constantly

### 2. Initialize Stock from WooCommerce
The system now reads actual stock quantities from WooCommerce API on startup instead of defaulting to 10 units.

**How it works:**
- On first load, fetches all products from WooCommerce
- Reads `stock_quantity` for each single SKU by product ID
- Uses actual WooCommerce stock as initial inventory
- Falls back to 0 if product not found or stock not managed

**Benefits:**
- Starts with real stock levels from WooCommerce
- No need to manually update initial stock
- Matches your actual inventory immediately
- More accurate from day one

---

## 📊 Technical Changes

### Modified Files

**1. `lib/utils/inventory.ts`**
- Added `initializeInventoryFromProducts()` function
- Reads stock from WooCommerce products array
- Matches by product ID from single_sku_list.csv

**2. `app/api/inventory/route.ts`**
- Added `ensureInventoryInitialized()` function
- Fetches products from WooCommerce on first request
- Initializes inventory with actual stock quantities
- Falls back to default (10) if API call fails

**3. `app/page.tsx`**
- Added auto-refresh toggle button
- Implements 30-second polling interval
- Visual indicator (pulsing green dot) when active
- Can be turned ON/OFF by user

---

## 🎯 User Experience Improvements

### Before
- Stock initialized to 10 units for all SKUs
- Manual refresh required to see changes
- No indication if data is stale

### After
- Stock initialized from WooCommerce actual quantities
- Auto-refresh every 30 seconds (optional)
- Clear indication of last update time
- Visual feedback when auto-refresh is active

---

## 📝 Usage

### Auto-Refresh Feature

**To enable auto-refresh:**
- Click the "Auto-refresh ON/OFF" button in header
- When ON: Green background with pulsing dot
- When OFF: Gray background, manual refresh only

**Refresh interval:**
- Every 30 seconds when enabled
- Happens in background, doesn't interrupt work
- Shows last updated time

**When to use:**
- Enable during busy periods (many orders)
- Enable when multiple users working
- Disable if working offline or testing

### WooCommerce Stock Initialization

**Automatic on startup:**
1. System starts
2. First API call to `/api/inventory`
3. Fetches all products from WooCommerce
4. Reads stock for each single SKU
5. Initializes inventory with actual quantities

**Requirements:**
- WooCommerce API credentials must be configured
- Products must have IDs matching single_sku_list.csv
- Products should have "Manage stock" enabled in WooCommerce

**Fallback behavior:**
- If WooCommerce unreachable: Uses 10 as default
- If product not found: Sets to 0 with warning
- If stock not managed: Sets to 0 with warning

---

## 🔧 Configuration

### Adjust Auto-Refresh Interval

Edit `app/page.tsx`, line ~45:

```typescript
const interval = setInterval(() => {
  fetchInventory();
}, 30000); // Change this value (milliseconds)
```

**Examples:**
- 10 seconds: `10000`
- 1 minute: `60000`
- 5 minutes: `300000`

### Disable Auto-Refresh by Default

Edit `app/page.tsx`, line ~12:

```typescript
const [autoRefresh, setAutoRefresh] = useState(false); // Change to false
```

---

## ⚠️ Important Notes

### Stock Quantity Requirements

For WooCommerce initialization to work:

1. **Products must exist in WooCommerce** with IDs matching CSV
2. **"Manage stock" must be enabled** in WooCommerce product settings
3. **Stock quantity must be set** (not null)

**To enable stock management in WooCommerce:**
1. Go to Products → Edit Product
2. Scroll to "Inventory" section
3. Check "Enable stock management at product level"
4. Set stock quantity
5. Save

### Single SKU Products Only

The system only initializes single SKUs from WooCommerce:
- ✅ him1, spu1, tad5/10tab, etc. (read from WooCommerce)
- ❌ Combo SKUs (calculated, never read from WooCommerce)

Combo SKUs are always calculated based on single SKU availability.

### Network Considerations

**Auto-refresh uses network:**
- Fetches inventory data every 30 seconds
- Small API call (~few KB)
- Minimal impact, but consider:
  - Mobile data usage if on cellular
  - Server load with many concurrent users

**Best practices:**
- Enable during active hours
- Disable overnight or during maintenance
- Monitor server load if 10+ concurrent users

---

## 🐛 Troubleshooting

### Issue: Stock shows 0 for all SKUs on startup

**Cause:** WooCommerce products not found or stock not managed

**Solution:**
1. Check product IDs in `single_sku_list.csv` match WooCommerce
2. Enable "Manage stock" for each single SKU product
3. Set stock quantities in WooCommerce
4. Restart the application

### Issue: Auto-refresh not working

**Symptoms:** Last updated time doesn't change

**Solutions:**
1. Check auto-refresh is ON (green button)
2. Check browser console for errors
3. Verify API endpoint is responding
4. Try manual refresh first

### Issue: Stock quantities don't match WooCommerce

**Cause:** Cached or stale data

**Solutions:**
1. Click manual "Refresh" button
2. Clear browser cache
3. Restart development server
4. Check WooCommerce API credentials

---

## 📈 Performance Impact

### Auto-Refresh
- **Network:** ~1-5 KB per request
- **Frequency:** Every 30 seconds
- **CPU:** Minimal (async background)
- **Impact:** Negligible for modern systems

### WooCommerce Initialization
- **Network:** ~10-50 KB (one-time on startup)
- **Time:** 1-3 seconds (depends on API)
- **Frequency:** Once per server restart
- **Impact:** Slight delay on first page load

---

## 🎉 Benefits Summary

### Real-Time Updates
✅ See changes within 30 seconds  
✅ Multiple users stay in sync  
✅ Catch WooCommerce updates automatically  
✅ Reduce manual refresh clicks  

### Accurate Initial Stock
✅ Start with real WooCommerce quantities  
✅ No manual initial stock updates needed  
✅ Match actual inventory immediately  
✅ Reduce setup time  

---

## 🔄 Version History

**v1.1.0** (Current)
- Added auto-refresh every 30 seconds
- Initialize stock from WooCommerce API
- Toggle auto-refresh ON/OFF
- Visual indicators for refresh status

**v1.0.0**
- Initial release
- Manual refresh only
- Stock initialized to 10 units

---

## 📚 Related Documentation

- **USAGE_GUIDE.md** - Updated usage instructions
- **README.md** - Complete technical reference
- **ARCHITECTURE.md** - System design

---

**Updated:** December 2024  
**Version:** 1.1.0






