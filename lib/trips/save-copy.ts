/**
 * Whether a shared or public trip offers to save a copy into the reader's own
 * account ("Save for later", "Save to My Trips"). Off unless
 * NEXT_PUBLIC_SAVE_COPY_ENABLED is "true". Joining, sharing and planning their own
 * stay either way.
 */
export function saveCopyShown(): boolean {
  return process.env.NEXT_PUBLIC_SAVE_COPY_ENABLED === "true";
}
