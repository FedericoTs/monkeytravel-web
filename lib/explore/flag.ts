/**
 * /explore UGC feature kill switch.
 *
 * Two-layer rollout:
 *   - This env flag is the master switch — when false, every /explore
 *     API route returns 404 and the UI components don't render.
 *   - PostHog FLAG_EXPLORE_UGC ("explore-ugc-v1") provides per-user
 *     cohort gating ONCE this flag is true. Week 1 / Week 2 leave this
 *     env flag false on prod; Week 3 launch flips it to true and PostHog
 *     does the 10% → 50% → 100% ramp.
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
