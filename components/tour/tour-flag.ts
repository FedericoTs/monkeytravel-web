// Kill-switch for the product tour. Lives on its own (rather than inside
// ./index.ts) so TourTrigger can import it without re-importing the barrel,
// which would create a circular dependency.
//
// When false:
//   - TourTrigger clicks bypass the tour and route to /trips/new (the wizard).
//     Previously routed to /auth/signup — that was killing conversion (per the
//     2026-05-23 audit: homepage → signup was the biggest top-of-funnel leak,
//     and the wizard now supports anonymous generation so the visitor can
//     reach value before being asked to sign up).
//   - useTourAutoShow returns [false, noop].
//   - The "New" badge on the homepage CTA is hidden.
//
// Flip to true to re-enable the guided product tour.
export const TOUR_ENABLED = false;
