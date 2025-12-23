-- Migration: Add language localization support
-- Description: Adds preferred_language to users and language to cache tables

-- Add preferred_language column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'en'
  CHECK (preferred_language IN ('en', 'es', 'it'));

-- Add language column to destination_activity_cache for multi-language caching
ALTER TABLE destination_activity_cache ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'en';

-- Update unique constraint to include language (if it exists)
-- First check if the constraint exists and drop it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_destination_cache'
  ) THEN
    ALTER TABLE destination_activity_cache DROP CONSTRAINT unique_destination_cache;
  END IF;
END $$;

-- Create new unique constraint with language
ALTER TABLE destination_activity_cache
ADD CONSTRAINT unique_destination_cache_lang
UNIQUE (destination_hash, budget_tier, vibes, language);

-- Create index for faster lookups by language
CREATE INDEX IF NOT EXISTS idx_users_preferred_language ON users(preferred_language);
CREATE INDEX IF NOT EXISTS idx_destination_cache_language ON destination_activity_cache(language);

-- Comment for documentation
COMMENT ON COLUMN users.preferred_language IS 'User preferred UI language: en, es, it';
COMMENT ON COLUMN destination_activity_cache.language IS 'Language of cached itinerary content';
