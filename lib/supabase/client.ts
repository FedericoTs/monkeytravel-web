"use client";

import { createBrowserClient } from "@supabase/ssr";

import { migrateAuthStorageOnce } from "@/lib/native/migrate-auth";
import { capacitorPreferencesStorage } from "@/lib/supabase/native-storage";

// Fire the one-shot legacy-token migration before any client is
// constructed. Self-gated to native + already-migrated, so it's a
// near-zero-cost no-op on web.
migrateAuthStorageOnce();

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function createClient() {
  // On the Capacitor native shell, swap WebView localStorage for the
  // Preferences-backed adapter (iOS Keychain / Android SharedPreferences).
  // Without this, iOS storage eviction + ITP silently sign users out.
  // On web, keep the default behavior unchanged.
  if (isNativePlatform()) {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: capacitorPreferencesStorage,
          flowType: "pkce",
          persistSession: true,
          detectSessionInUrl: true,
        },
      }
    );
  }

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
