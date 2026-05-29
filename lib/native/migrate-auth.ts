/**
 * One-shot copy of legacy Supabase auth tokens from WebView localStorage
 * into Capacitor Preferences.
 *
 * Background
 * ----------
 * Before task #173 the native wrap stored auth in WebView localStorage,
 * which iOS evicts (storage pressure + ITP 7-day cap). We are switching
 * the Supabase client to a Preferences-backed adapter (see
 * `lib/supabase/native-storage.ts`). Without this migration, every
 * already-installed wrapped user would be silently signed out the next
 * time they opened the app after the update.
 *
 * What it does
 * ------------
 * Once per install, on the native shell only:
 *   1. Scan localStorage for keys matching `sb-*-auth-token`
 *      (the project-keyed token supabase-js writes)
 *   2. Mirror each into Preferences (so the new storage adapter sees them)
 *   3. Mark the migration done in Preferences with a versioned flag
 *
 * Web is a strict no-op. Subsequent launches short-circuit on the flag.
 * Failures are swallowed — the worst case is that a user has to log in
 * once after the update, which is exactly the situation we're trying
 * to avoid but is not catastrophic.
 *
 * Imported at the top of `lib/supabase/client.ts` so it fires before
 * any `createClient()` call has a chance to write a fresh empty
 * Preferences entry over the legacy localStorage one.
 */

const MIGRATION_FLAG_KEY = "mt_auth_migrated_v1";

let migrationPromise: Promise<void> | null = null;

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

async function runMigration(): Promise<void> {
  if (!isNativePlatform()) return;
  if (typeof localStorage === "undefined") return;

  try {
    const { Preferences } = await import("@capacitor/preferences");

    // Short-circuit if we've already migrated on this install.
    const { value: alreadyMigrated } = await Preferences.get({
      key: MIGRATION_FLAG_KEY,
    });
    if (alreadyMigrated === "true") return;

    // Find every legacy supabase-js auth-token entry. These look like
    // `sb-<project-ref>-auth-token` — usually one, but theoretically
    // more if the user signed into multiple Supabase projects.
    const keysToMigrate: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && /^sb-.*-auth-token$/.test(key)) {
        keysToMigrate.push(key);
      }
    }

    for (const key of keysToMigrate) {
      try {
        const value = localStorage.getItem(key);
        if (value === null) continue;
        await Preferences.set({ key, value });
      } catch (err) {
        console.warn("[migrate-auth] failed to copy key", key, err);
      }
    }

    await Preferences.set({ key: MIGRATION_FLAG_KEY, value: "true" });
  } catch (err) {
    // Plugin load failed or Preferences unavailable — leave the flag
    // unset so we'll retry on the next launch.
    console.warn("[migrate-auth] migration skipped:", err);
  }
}

/**
 * Idempotent — multiple callers share the same promise.
 * Safe to invoke at module top level: it self-gates on platform and
 * on the persisted flag.
 */
export function migrateAuthStorageOnce(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runMigration();
  }
  return migrationPromise;
}
