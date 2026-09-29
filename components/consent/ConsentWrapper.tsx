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
 * userId becomes set.
 */

import { ReactNode } from "react";
import dynamic from "next/dynamic";
import { ConsentProvider, useConsent } from "@/lib/consent";
import { useAuth } from "@/components/auth/AuthProvider";

// Fetched only when there is something to show: most visitors have answered.
const CookieConsentBanner = dynamic(
  () => import("./CookieConsentBanner").then((m) => m.CookieConsentBanner),
  { ssr: false }
);
const CookieSettingsModal = dynamic(
  () => import("./CookieSettingsModal").then((m) => m.CookieSettingsModal),
  { ssr: false }
);

/** The banner stays mounted while the settings modal is open so it keeps its state. */
function ConsentUi() {
  const { bannerStatus } = useConsent();
  return (
    <>
      {bannerStatus !== "hidden" && <CookieConsentBanner />}
      {bannerStatus === "settings_open" && <CookieSettingsModal />}
    </>
  );
}

interface ConsentWrapperProps {
  children: ReactNode;
}

export function ConsentWrapper({ children }: ConsentWrapperProps) {
  // Task #181 cleanup: read auth state from the single AuthProvider
  // instead of running our own getUser() + onAuthStateChange listener.
  // ConsentProvider tolerates `userId={null}` and re-runs its effect
  // when userId becomes set — same shape as before, fewer round-trips.
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return (
    <ConsentProvider userId={userId}>
      {children}
      <ConsentUi />
    </ConsentProvider>
  );
}

export default ConsentWrapper;
