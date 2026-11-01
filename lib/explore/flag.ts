/**
 * /explore UGC feature kill switch.
 *
 * Single switch — when false, every /explore API route returns 404 and no
 * publish UI renders. When true, the feature is on for everyone.
 *
 * There is no second (PostHog cohort) layer: both publish surfaces, the
 * post-save Publish CTA and the /trips/[id] toggle, read this function and
 * nothing else, so they cannot disagree.
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
