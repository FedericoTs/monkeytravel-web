/**
 * Who persists a signed-in user's generated itinerary?
 *
 * Auto-save does, always, unless NEXT_PUBLIC_AUTO_SAVE_FORCE=off is set; then
 * the post-auth effect that replays the user's Save click does. Exactly one of
 * the two owns persistence in every state. It is an environment variable, not
 * a client-side flag: an unresolved or stale flag in a browser used to switch
 * saving off and lose trips.
 */

/** Value of NEXT_PUBLIC_AUTO_SAVE_FORCE that turns auto-save off. */
export const AUTO_SAVE_FORCE_OFF = "off";

/** Should the wizard auto-persist a signed-in user's itinerary? */
export function shouldAutoSave(envForce?: string | null): boolean {
  return envForce !== AUTO_SAVE_FORCE_OFF;
}

/** Should the post-auth redemption effect replay the user's Save click? */
export function shouldRedeemSaveIntent(envForce?: string | null): boolean {
  return envForce === AUTO_SAVE_FORCE_OFF;
}
