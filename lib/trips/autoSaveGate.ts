/**
 * Who persists a signed-in user's generated itinerary?
 *
 * History, because this gate has already lost trips twice:
 *
 *   - Originally the PostHog flag `auto-save-v1` gated auto-save AND the
 *     post-auth "redeem the Save click" effect was gated on the flag being
 *     false. An UNRESOLVED flag (consent declined, ad blocker, failed
 *     request) satisfied neither, so nothing persisted — 30 users, 44 burned
 *     generations, zero trips (fixed 20b5760: undefined → auto-save).
 *
 *   - Then, 2026-09-02: six more signed-in users in 30 days reached a
 *     rendered result and no save was ever ATTEMPTED — Supabase edge logs
 *     show their browsers authenticated before and after, and not one
 *     getUser or insert_trip_dedup call in between. The flag has been at
 *     rollout 100% since 2026-07-02, and every browser PostHog could see
 *     received `true` (225/225 in 30 days). The browsers it could NOT see
 *     are the point: posthog-js caches flags in localStorage, and a
 *     returning browser whose cached set predates the flag, with the
 *     /flags refresh blocked, evaluates `isFeatureEnabled` to a hard
 *     `false` — which a "kill switch that only honours explicit false"
 *     obeys. That population never reaches PostHog, so it was invisible by
 *     construction.
 *
 * Decision: saving what a signed-in user asked for is product behaviour,
 * not a rollout. The flag is no longer consulted. The kill switch is an
 * environment variable (NEXT_PUBLIC_AUTO_SAVE_FORCE=off) — a redeploy, but
 * one that cannot be spoofed by a stale cache in one visitor's browser.
 * `flag` stays in the signature so call sites and the invariants below keep
 * compiling; it is intentionally ignored.
 */

export type FlagState = boolean | undefined;

/** Value of NEXT_PUBLIC_AUTO_SAVE_FORCE that turns auto-save off. */
export const AUTO_SAVE_FORCE_OFF = "off";

/**
 * Should the wizard auto-persist a signed-in user's itinerary?
 * Always — unless the environment kill switch is set. `flag` is ignored.
 */
export function shouldAutoSave(_flag: FlagState, envForce?: string | null): boolean {
  return envForce !== AUTO_SAVE_FORCE_OFF;
}

/**
 * Should the post-auth redemption effect replay the user's Save click?
 * Only when auto-save is off — the two are complements, and exactly one of
 * them must own persistence in every state (proven in autoSaveGate.vitest.ts).
 */
export function shouldRedeemSaveIntent(_flag: FlagState, envForce?: string | null): boolean {
  return envForce === AUTO_SAVE_FORCE_OFF;
}
