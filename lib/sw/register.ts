/**
 * Service worker registration helper.
 *
 * Only registers on routes where the cache is useful (/trips/*) so we
 * don't pay the SW install cost on /blog or marketing pages.
 *
 * Idempotent: subsequent calls are no-ops because the browser de-dupes
 * by script URL.
 *
 * Errors are logged but never thrown — a failed SW registration must
 * never break the page.
 */

let registered = false;

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  if (registered) return;
  const cap = (window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return;
  if (!("serviceWorker" in navigator)) {
    // Older browsers / Capacitor on some old Android versions.
    return;
  }

  // Don't register in dev mode — the SW would interfere with HMR. The
  // production deploy always sets NODE_ENV=production.
  if (process.env.NODE_ENV !== "production") return;

  // Only register when the user is in the part of the app that benefits
  // from offline. Marketing pages get the network-only path.
  const path = window.location.pathname;
  const isTripPath = /\/trips(\/|$)/.test(path);
  if (!isTripPath) return;

  try {
    registered = true;
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    // Reset so a future call from a different /trips/* mount can retry.
    registered = false;
    console.warn("[sw] registration failed:", err);
  }
}

