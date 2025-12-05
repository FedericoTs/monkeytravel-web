-- Migration: Create trip_checklists table for pre-trip preparation checklist
-- Date: 2024-12-05
-- Description: Adds checklist functionality for trip preparation (bookings, packing, documents)

-- Create trip_checklists table
CREATE TABLE IF NOT EXISTS trip_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Item data
  text TEXT NOT NULL,
  category TEXT DEFAULT 'custom' CHECK (category IN ('booking', 'packing', 'document', 'custom')),
  is_checked BOOLEAN DEFAULT FALSE,
  due_date DATE,
  sort_order INTEGER DEFAULT 0,

  -- Auto-generated from activity?
  source_activity_id TEXT,  -- If generated from booking_required activity

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  checked_at TIMESTAMPTZ
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_trip_checklists_trip ON trip_checklists(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_checklists_user ON trip_checklists(user_id);

-- Enable Row Level Security
ALTER TABLE trip_checklists ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can manage their own checklists
CREATE POLICY "Users can manage their own checklists"
ON trip_checklists
FOR ALL
USING (auth.uid() = user_id);

-- Comment on table
COMMENT ON TABLE trip_checklists IS 'Stores pre-trip preparation checklist items for each trip';
COMMENT ON COLUMN trip_checklists.category IS 'Category of checklist item: booking, packing, document, or custom';
COMMENT ON COLUMN trip_checklists.source_activity_id IS 'References activity.id if this item was auto-generated from an activity with booking_required';
