-- ========================================
-- Set Database Timezone to GMT+8
-- ========================================
-- This migration sets the database timezone to Asia/Kuala_Lumpur (GMT+8)
-- Note: PostgreSQL stores timestamps in UTC internally, but this setting
-- affects how timestamps are displayed and interpreted in queries.
-- ========================================

-- Set timezone for the current session
SET timezone = 'Asia/Kuala_Lumpur';

-- Set timezone for the database (replace 'HC_live_dashboard' with your actual database name)
-- Note: For Neon DB, you may need to use the connection string database name
-- If you get permission errors, you can skip this line and just use the session-level setting
ALTER DATABASE "HC_live_dashboard" SET timezone = 'Asia/Kuala_Lumpur';

-- Alternative: If ALTER DATABASE doesn't work, you can set it per connection
-- by adding ?options=-c%20timezone%3DAsia%2FKuala_Lumpur to your connection string
-- Or set it in your application's connection pool settings

-- Verify timezone setting
SHOW timezone;

-- ========================================
-- Optional: Set timezone for specific schema
-- ========================================
-- If you want to set timezone specifically for the inventory_management schema,
-- you can use this (though database-level setting is usually sufficient):

-- ALTER SCHEMA inventory_management SET timezone = 'Asia/Kuala_Lumpur';

-- ========================================
-- Note on Timestamp Columns
-- ========================================
-- PostgreSQL TIMESTAMP WITH TIME ZONE columns store values in UTC internally
-- and convert them to the session timezone when displayed.
-- 
-- Our application code also handles GMT+8 conversion for display,
-- so timestamps will be correctly shown in GMT+8 both in:
-- 1. Direct database queries (via this timezone setting)
-- 2. Application UI (via our date utility functions)
-- ========================================

