-- Migration: Add cookie consent columns to users table
-- Purpose: Store GDPR-compliant cookie consent preferences
-- Date: 2026-01-25

-- Add cookie_consent column to store consent preferences
-- Structure: { essential: true, analytics: boolean, sessionRecording: boolean, marketing: boolean }
ALTER TABLE users
ADD COLUMN IF NOT EXISTS cookie_consent JSONB;

-- Add timestamp for when consent was last updated
ALTER TABLE users
ADD COLUMN IF NOT EXISTS cookie_consent_updated_at TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN users.cookie_consent IS 'GDPR cookie consent preferences: { essential: true (always), analytics: bool, sessionRecording: bool, marketing: bool }';
COMMENT ON COLUMN users.cookie_consent_updated_at IS 'Timestamp when cookie consent was last updated';

-- Create index for efficient querying of consent status (if needed for analytics)
CREATE INDEX IF NOT EXISTS idx_users_cookie_consent_analytics
ON users ((cookie_consent->>'analytics'))
WHERE cookie_consent IS NOT NULL;
