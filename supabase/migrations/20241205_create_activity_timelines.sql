-- Migration: Create activity_timelines table for live trip tracking
-- Date: 2024-12-05
-- Description: Tracks activity status, ratings, and notes during active trips

-- Create activity_timelines table
CREATE TABLE IF NOT EXISTS activity_timelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,  -- References activity in itinerary JSON
  day_number INTEGER NOT NULL,

  -- Status tracking
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'in_progress', 'completed', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  actual_duration_minutes INTEGER,

  -- Rating and feedback
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  experience_notes TEXT,
  quick_tags TEXT[] DEFAULT '{}',

  -- Skip reason (if skipped)
  skip_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one timeline entry per activity per user per trip
  UNIQUE (trip_id, activity_id, user_id)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_activity_timelines_trip ON activity_timelines(trip_id);
CREATE INDEX IF NOT EXISTS idx_activity_timelines_user ON activity_timelines(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_timelines_status ON activity_timelines(status);
CREATE INDEX IF NOT EXISTS idx_activity_timelines_trip_day ON activity_timelines(trip_id, day_number);

-- Enable Row Level Security
ALTER TABLE activity_timelines ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can manage their own activity timelines
CREATE POLICY "Users can manage their own activity timelines"
ON activity_timelines
FOR ALL
USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_activity_timeline_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_activity_timeline_updated_at ON activity_timelines;
CREATE TRIGGER trigger_update_activity_timeline_updated_at
  BEFORE UPDATE ON activity_timelines
  FOR EACH ROW
  EXECUTE FUNCTION update_activity_timeline_updated_at();

-- Comments
COMMENT ON TABLE activity_timelines IS 'Tracks status, ratings, and notes for activities during active trips';
COMMENT ON COLUMN activity_timelines.activity_id IS 'References activity ID from the trip itinerary JSON';
COMMENT ON COLUMN activity_timelines.status IS 'Activity status: upcoming, in_progress, completed, or skipped';
COMMENT ON COLUMN activity_timelines.quick_tags IS 'Quick feedback tags like must-do, crowded, worth-it, etc.';
