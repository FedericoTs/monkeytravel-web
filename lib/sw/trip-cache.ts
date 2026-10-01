/**
 * The service worker keeps opened trips readable offline (public/sw.js). A
 * cached trip page holds its account's private plan, so the copies belong to
 * the account that opened them: signing out, or into another account, drops
 * them, or the next person on a shared browser could open them from history.
 */

const OWNER_KEY = "mt-trip-cache-owner";

/** Call with the signed-in user's id, or null when nobody is signed in. */
export async function syncTripCacheOwner(userId: string | null): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  let owner: string | null | undefined;
  try {
    owner = localStorage.getItem(OWNER_KEY);
  } catch {
    // Storage blocked: the owner is unknown, so nothing is kept.
    owner = undefined;
  }
  // Signed out always clears: a request in flight at sign-out can still land.
  if (userId !== null && owner === userId) return;
  try {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.endsWith("-trips")).map((name) => caches.delete(name)));
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Nothing to drop, or the marker was refused: the next page load retries.
  }
}
