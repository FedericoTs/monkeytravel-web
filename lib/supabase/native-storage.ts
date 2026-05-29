/**
 * Supabase auth storage adapter backed by @capacitor/preferences.
 *
 * Why this exists
 * ---------------
 * On the web, supabase-js persists the session in `localStorage`. Inside
 * the iOS WKWebView that powers the Capacitor wrap, `localStorage` is
 * not durable:
 *   - iOS evicts WebView localStorage under storage pressure
 *   - Intelligent Tracking Prevention (ITP) caps it at ~7 days for
 *     "third-party" storage
 *   - The user is silently signed out the next cold launch, which
 *     breaks the entire native session lifetime story
 *
 * Capacitor Preferences writes to the iOS Keychain / Android
 * SharedPreferences, both of which survive eviction and ITP.
 *
 * Shape: Supabase's `auth.storage` option expects an object with
 * `getItem` / `setItem` / `removeItem` — all async-tolerant. We
 * dynamic-import @capacitor/preferences so the plugin code never enters
 * the regular web bundle.
 *
 * This file is paired with `migrate-auth-to-native.ts` (one-shot copy
 * of legacy `sb-*-auth-token` localStorage keys into Preferences so
 * existing wrapped users don't get logged out by the storage swap).
 *
 * NOT to be confused with the more general `lib/platform/storage.ts`
 * wrapper (task #176). This adapter is purpose-built for the Supabase
 * client and intentionally lives next to it.
 */

type PreferencesModule = typeof import("@capacitor/preferences");

/**
 * Lazily-loaded reference to the @capacitor/preferences plugin. We hold
 * the resolved promise so concurrent reads share a single import.
 */
let preferencesPromise: Promise<PreferencesModule["Preferences"]> | null = null;

function loadPreferences(): Promise<PreferencesModule["Preferences"]> {
  if (!preferencesPromise) {
    preferencesPromise = import("@capacitor/preferences").then(
      (mod) => mod.Preferences
    );
  }
  return preferencesPromise;
}

/**
 * Storage adapter implementing the shape Supabase auth expects.
 * All operations are async. Failures are swallowed (and warned) so a
 * plugin glitch never crashes the auth state machine — supabase-js
 * treats a thrown getItem as a fatal error.
 */
export const capacitorPreferencesStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const Preferences = await loadPreferences();
      const { value } = await Preferences.get({ key });
      return value ?? null;
    } catch (err) {
      console.warn("[supabase/native-storage] getItem failed", key, err);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      const Preferences = await loadPreferences();
      await Preferences.set({ key, value });
    } catch (err) {
      console.warn("[supabase/native-storage] setItem failed", key, err);
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      const Preferences = await loadPreferences();
      await Preferences.remove({ key });
    } catch (err) {
      console.warn("[supabase/native-storage] removeItem failed", key, err);
    }
  },
};
