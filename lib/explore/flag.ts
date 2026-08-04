/**
 * /explore UGC feature kill switch.
 *
 * Single switch — when false, every /explore API route returns 404 and no
 * publish UI renders. When true, the feature is on for everyone.
 *
 * There WAS meant to be a second layer: PostHog "explore-ugc-v1" doing a
 * 10% → 50% → 100% cohort ramp on top of this. That flag was never created,
 * which silently pinned the post-save Publish CTA at 0% of users while the
 * /trips/[id] toggle (env-gated only) ran at 100% — two publish surfaces
 * disagreeing for months. The ramp layer was removed 2026-08-04; both
 * surfaces now read this function and nothing else.
 *
 * Why an env flag (vs only PostHog): server routes need a fast, sync
 * gate that doesn't depend on PostHog being reachable. If PostHog is
 * down or slow, the env flag still works.
 */

/** True when the entire /explore surface is reachable. Default: false. */
export function isExploreUgcEnabled(): boolean {
  // Server-only env. Will be undefined on the client; that's fine since
  // client components also check via PostHog before rendering.
  return process.env.EXPLORE_UGC_ENABLED === "true";
}
