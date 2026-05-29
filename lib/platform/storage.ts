/**
 * Platform-aware persistent key/value storage.
 *
 * Why this exists: iOS WKWebView evicts localStorage under storage
 * pressure and after 7 days of ITP inactivity. That's fine for
 * decoration state (a dismissed banner, a completed tour) — but for
 * AUTH-HANDOFF keys (the "I clicked Generate as an anon, came back
 * from signup, and now the wizard should auto-run") eviction means
 * the user lands on an empty page after the highest-intent step of
 * the funnel. So inside the Capacitor native shell we route those
 * keys through @capacitor/preferences (NSUserDefaults / Android
 * SharedPreferences), which is durable and survives ITP.
 *
 * On the regular web (or SSR) we keep the localStorage path — async
 * wrappers so the call sites have one consistent contract.
 *
 * Design choices:
 *   - Async API everywhere — Capacitor's Preferences plugin is async,
 *     so the lowest-common-denominator wins. Web callers just `await`
 *     a Promise that resolves synchronously.
 *   - Dynamic import of @capacitor/preferences — the plugin must
 *     never enter the regular web bundle. Matches the pattern in
 *     lib/native/share.ts and lib/native/back-button.ts.
 *   - Quota / unavailable errors are swallowed (returned as null /
 *     no-op) — these helpers are for soft-state handoffs, never for
 *     correctness-critical data. Crashing the UI because Safari is
 *     in private mode would be worse than the missed handoff.
 *
 * Scope: USE for auth-handoff and similar must-survive-redirect
 * keys. DO NOT use for decoration state (tour-completed,
 * banner-dismissed, etc.) — those are fine on plain localStorage and
 * adding the async hop is just noise.
 */

export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * True when we're running inside the Capacitor native shell (iOS or
 * Android WebView). Matches the pattern used by other lib/native
 * helpers — the `Capacitor` global is injected by the runtime; in a
 * plain browser it's undefined.
 */
function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Web implementation: thin async wrapper around localStorage.
 *
 * Try/catch on every op because:
 *   - Safari private-mode throws QuotaExceededError on setItem.
 *   - Some embedded WebViews disable Web Storage entirely (getItem
 *     throws SecurityError).
 *   - SSR has no `localStorage` at all (typeof window === "undefined").
 * For our use case (soft auth handoffs) silently dropping a write is
 * strictly better than crashing — the user just hits the un-restored
 * post-login path, which still works.
 */
const webPrefs: Storage = {
  async get(key: string): Promise<string | null> {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota / SecurityError — ignore. See file-header rationale.
    }
  },
  async remove(key: string): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};

/**
 * Native implementation: routes through @capacitor/preferences. The
 * plugin is dynamic-imported on every call so it never enters the
 * regular web bundle (same trick as lib/native/share.ts). The import
 * is cached by the JS module loader, so the cost is paid once per
 * page load.
 */
const capacitorPrefs: Storage = {
  async get(key: string): Promise<string | null> {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key });
      return value ?? null;
    } catch (err) {
      console.warn("[platform/storage] Capacitor get failed:", err);
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key, value });
    } catch (err) {
      console.warn("[platform/storage] Capacitor set failed:", err);
    }
  },
  async remove(key: string): Promise<void> {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.remove({ key });
    } catch (err) {
      console.warn("[platform/storage] Capacitor remove failed:", err);
    }
  },
};

/**
 * The platform-appropriate storage backend.
 *
 * Note: the `isNative()` check runs at module-load time on the
 * client (the file is "use client"-imported through the call sites).
 * On the server `isNative()` returns false, so SSR gets the web
 * wrapper — which itself is a no-op when `window` is undefined.
 */
export const prefs: Storage = isNative() ? capacitorPrefs : webPrefs;
