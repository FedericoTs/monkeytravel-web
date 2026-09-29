-- The claim UPDATE runs with RETURNING, so the updated row must stay visible
-- to the user who claimed it. Under the unclaimed-only read policy every
-- claim failed with 42501, and no ChatGPT itinerary was ever claimed.
DROP POLICY IF EXISTS "Public can read unclaimed itineraries" ON mcp_itineraries;
CREATE POLICY "Public can read unclaimed itineraries"
  ON mcp_itineraries FOR SELECT
  USING (claimed_by IS NULL OR claimed_by = (SELECT auth.uid()));
