-- ========================================
-- Migration: Remove google_id and picture columns
-- ========================================
-- Run this if you have an existing database with these columns
-- This will remove google_id and picture from the users table

-- Drop the index on google_id (if exists)
DROP INDEX IF EXISTS inventory_management.idx_users_google_id;

-- Drop the unique constraint on google_id (if exists)
ALTER TABLE inventory_management.users DROP CONSTRAINT IF EXISTS users_google_id_key;

-- Remove google_id column
ALTER TABLE inventory_management.users DROP COLUMN IF EXISTS google_id;

-- Remove picture column
ALTER TABLE inventory_management.users DROP COLUMN IF EXISTS picture;

-- Verify the changes
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'inventory_management'
  AND table_name = 'users'
ORDER BY ordinal_position;


