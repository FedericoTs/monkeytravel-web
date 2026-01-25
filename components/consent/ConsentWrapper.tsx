"use client";

/**
 * Consent Wrapper Component
 *
 * Wraps the app with ConsentProvider and renders consent UI.
 * Gets user ID from Supabase auth for syncing consent.
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
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    async function getUserId() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setUserId(user?.id ?? null);
      } catch {
        setUserId(null);
      } finally {
        setIsLoaded(true);
      }
    }

    getUserId();

    // Listen for auth changes
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Wait for auth check before rendering to avoid flash
  if (!isLoaded) {
    return <>{children}</>;
  }

  return (
    <ConsentProvider userId={userId}>
      {children}
      <CookieConsentBanner />
      <CookieSettingsModal />
    </ConsentProvider>
  );
}

export default ConsentWrapper;
