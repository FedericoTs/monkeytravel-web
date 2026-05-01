"use client";

/**
 * Consent Wrapper Component
 *
 * Wraps the app with ConsentProvider and renders consent UI.
 * Gets user ID from Supabase auth for syncing consent.
 *
 * IMPORTANT: This component must NEVER conditionally swap its outer tree
 * shape (e.g. Fragment vs ConsentProvider) based on auth state. Doing so
 * causes React to unmount and remount the entire `children` tree when the
 * check resolves, which flashes every client component below — Navbar's
 * auth skeleton, CuratedEscapes' loading state, etc. Always render the
 * provider; it tolerates `userId={null}` and re-runs its effect when
 * userId becomes set. The CookieConsentBanner self-hides when
 * `bannerStatus !== "visible"`, so it's safe to always render too.
 */

import { ReactNode, useEffect, useState } from "react";
import { ConsentProvider } from "@/lib/consent";
import { CookieConsentBanner } from "./CookieConsentBanner";
import { CookieSettingsModal } from "./CookieSettingsModal";
import { createClient } from "@/lib/supabase/client";

interface ConsentWrapperProps {
  children: ReactNode;
}

export function ConsentWrapper({ children }: ConsentWrapperProps) {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth
      .getUser()
      .then(({ data: { user } }) => setUserId(user?.id ?? null))
      .catch(() => setUserId(null));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <ConsentProvider userId={userId}>
      {children}
      <CookieConsentBanner />
      <CookieSettingsModal />
    </ConsentProvider>
  );
}

export default ConsentWrapper;
