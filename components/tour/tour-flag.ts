// Kill-switch for the product tour. Lives on its own (rather than inside
// ./index.ts) so TourTrigger can import it without re-importing the barrel,
// which would create a circular dependency.
//
// Set to false on 2026-05-02 to A/B-measure signup conversion lift over
// ~2 weeks. The tour was capping users at "Step 5 of 5 — Plan Together"
// before the off-by-one fix; want to confirm the tour itself is net-positive
// for signup before re-enabling.
//
// When false:
//   - TourTrigger clicks bypass the tour and route directly to /auth/signup.
//   - useTourAutoShow returns [false, noop].
//   - The "New" badge on the homepage CTA is hidden.
//
// Re-enable by flipping to true once we have the data.
export const TOUR_ENABLED = false;
