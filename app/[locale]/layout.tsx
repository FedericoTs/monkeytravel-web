import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import AuthEventTracker from "@/components/analytics/AuthEventTracker";
import EngagementBeacon from "@/components/analytics/EngagementBeacon";
import { ToastProvider } from "@/components/ui/Toast";
import MaintenanceWrapper from "@/components/MaintenanceWrapper";
import { ProfileCompletionProvider } from "@/components/profile";
import { ConsentWrapper } from "@/components/consent";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { routing } from "@/lib/i18n/routing";

// Generate static params for all supported locales
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  // Validate locale
  if (!routing.locales.includes(locale as typeof routing.locales[number])) {
    notFound();
  }

  // Enable static rendering
  setRequestLocale(locale);

  // Get all messages for client components
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <AuthProvider>
        {/*
         * Reads ?auth_event=... from the OAuth callback and fires the
         * signup/login analytics. It MUST live here, at the layout level,
         * not on a single page: app/auth/callback/route.ts computes
         * `next !== "/trips" ? next : "/trips/new"`, so a newly signed-up
         * user is redirected to whatever page the flow started from and
         * never to /trips — which is where this used to be mounted. The
         * result was that 30 days produced 146 real signups and 4
         * user_signed_up events. Suspense is required because the tracker
         * calls useSearchParams().
         */}
        <Suspense fallback={null}>
          <AuthEventTracker />
          {/* Counts a session as a visit after a few visible seconds. The
              only signal that separates a reader from a fetcher outside the
              wizard — see components/analytics/EngagementBeacon.tsx. */}
          <EngagementBeacon />
        </Suspense>
        <ConsentWrapper>
          <ToastProvider>
            <ProfileCompletionProvider>
              <MaintenanceWrapper>{children}</MaintenanceWrapper>
            </ProfileCompletionProvider>
          </ToastProvider>
        </ConsentWrapper>
      </AuthProvider>
    </NextIntlClientProvider>
  );
}
