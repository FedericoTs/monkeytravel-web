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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      // Subsequent state changes are not "loading" — only the first
      // hydration is. Once we've heard from auth at least once we're
      // out of the loading state regardless of which path resolved first.
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
