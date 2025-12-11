-- ========================================
-- Set Database Timezone to GMT+8 (Simple Version)
-- ========================================
-- This is a simpler version that only sets the session timezone.
-- Run this in your database connection.
-- ========================================

-- Set timezone for the current session
SET timezone = 'Asia/Kuala_Lumpur';

-- Verify the setting
SHOW timezone;
-- Expected output: Asia/Kuala_Lumpur

-- ========================================
-- For Permanent Setting:
-- ========================================
-- Option 1: Add to your connection string:
-- ?options=-c%20timezone%3DAsia%2FKuala_Lumpur
--
-- Option 2: Set in your application code (lib/db/connection.ts):
-- After creating the pool, run: await pool.query("SET timezone = 'Asia/Kuala_Lumpur'");
--
-- Option 3: If you have database admin access:
-- ALTER DATABASE "your_database_name" SET timezone = 'Asia/Kuala_Lumpur';
-- ========================================


