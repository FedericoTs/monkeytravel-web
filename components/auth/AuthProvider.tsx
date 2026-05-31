"use client";

/**
 * AuthProvider — single source of truth for client-side Supabase auth state.
 *
 * Why this exists: prior to task #181 the app fired ~4 separate
 * `supabase.auth.getUser()` calls and registered ~2 `onAuthStateChange`
 * listeners on every page render (Navbar, NotificationBell, ConsentWrapper,
 * MaintenanceWrapper, ProfileCompletionProvider, ...). Each getUser is a
 * round-trip to Supabase Auth; each listener is a long-lived subscription.
 * On a marketing-page render that's pure waste.
 *
 * This provider runs ONE getUser on mount, registers ONE onAuthStateChange,
 * and exposes { user, loading } via a context hook. Per-page subscribers
 * just call `useAuth()`.
 *
 * IMPORTANT: must be mounted inside the [locale] layout so it wraps every
 * route — see app/[locale]/layout.tsx.
 *
 * Local-state listeners (e.g. ConsentWrapper sync, per-modal auth-driven
 * UI toggles) can still subscribe independently — context is for the
 * "do I have a user?" question, not for replacing every Supabase event
 * bus consumer.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { identify } from "@/lib/posthog/identify";

/**
 * Module-level set of user.ids we've already PostHog-identified on this
 * page-load. Task #207: AuthProvider fires a lightweight identify on every
 * mount with a non-null user so returning-user page-loads (where neither
 * the auth-callback nor the email login/signup forms run) still stitch
 * PostHog events to the authenticated profile. We short-circuit duplicates
 * so a re-render or a 2nd AuthProvider mount (theoretically impossible
 * since it's in the [locale] layout, but defensive) doesn't churn.
 *
 * SessionTracker also identifies — with the full DB-derived property set —
 * but that runs behind requestIdleCallback and can be 5s late. This early
 * identify gets the user.id onto the distinct_id immediately so any event
 * captured during the first 5s lands on the right profile.
 */
const identifiedThisPageLoad = new Set<string>();

interface AuthContextValue {
  user: User | null;
  /**
   * True until the initial getUser() resolves. Consumers that want to
   * render a skeleton on first paint can gate on this; consumers that
   * prefer the "default to logged-out CTAs" approach (Navbar) can
   * ignore it and just read `user`.
   */
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Read the centralized auth state. Throws if called outside AuthProvider
 * to fail loud during development — every page sits inside the [locale]
 * layout which mounts the provider, so this should never throw in prod.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

/**
 * Non-throwing variant for components that may be mounted ABOVE the
 * [locale] layout — i.e. in the root app/layout.tsx tree, which sits
 * outside AuthProvider's scope. Returns the safe default (no user, not
 * loading) so the consumer's "anonymous" branch runs cleanly instead
 * of crashing SSR.
 *
 * Use this ONLY when the component must mount in the root layout for
 * structural reasons (SessionTracker is the canonical example — it
 * predates AuthProvider and stays in root for cross-locale session
 * continuity). Inside the [locale] tree, prefer `useAuth()` so missing
 * providers fail loud.
 */
export function useAuthOptional(): AuthContextValue {
  const ctx = useContext(AuthContext);
  return ctx ?? { user: null, loading: false };
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    // Single initial fetch — replaces N per-component getUser() calls.
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (!mounted) return;
      setUser(u);
      setLoading(false);
    });

    // Single subscription — replaces N per-component listeners.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      // Subsequent state changes are not "loading" — only the first
      // hydration is. Once we've heard from auth at least once we're
      // out of the loading state regardless of which path resolved first.
      setLoading(false);

      // 2026-05-31 mobile-audit P2: re-register the push device row on
      // in-session sign-in. NativeBoot only calls initPushOnce() on
      // cold launch, so a user who signs in mid-session never gets a
      // user_id-linked device row → every server-side push silently
      // no-ops with `no_active_devices` until the next cold launch.
      // Capacitor.isNativePlatform() gate keeps web users from paying
      // for the dynamic import or the @capacitor/push-notifications
      // chunk on every login.
      if (event === "SIGNED_IN") {
        const cap = (
          window as typeof window & {
            Capacitor?: { isNativePlatform?: () => boolean };
          }
        ).Capacitor;
        if (cap?.isNativePlatform?.()) {
          void import("@/lib/native/push")
            .then(({ initPushOnce }) => initPushOnce())
            .catch(() => undefined);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Task #207: idempotent PostHog identify whenever we have a non-null
  // user. Covers the returning-user page-load case (browser tab reopened,
  // session restored from cookie) where the auth-callback and the
  // signup/login forms never fire. Fire-and-forget — never blocks render.
  useEffect(() => {
    if (!user) return;
    if (identifiedThisPageLoad.has(user.id)) return;
    identifiedThisPageLoad.add(user.id);
    identify(user.id, {
      email: user.email,
      name:
        (user.user_metadata?.display_name as string | undefined) ||
        (user.user_metadata?.full_name as string | undefined),
    }).catch(() => {
      // posthog-js not loaded yet (lazy import) or blocked by a privacy
      // extension. SessionTracker will re-identify with full properties
      // after requestIdleCallback fires; drop quietly here.
      identifiedThisPageLoad.delete(user.id);
    });
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
