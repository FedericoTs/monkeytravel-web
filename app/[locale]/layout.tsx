import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { bodyFontClassName } from "@/app/fonts";
import { routing } from "@/lib/i18n/routing";
import { MARKETING_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";
import { gaConsentDefaultScriptProps } from "@/lib/analytics/ga-consent";
import {
  generateOrganizationSchema,
  generateWebSiteSchema,
  generateSoftwareApplicationSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { HERO_DOODLE_ENABLED } from "@/components/marketing/doodle";
import BuildHopFeedbackWidget from "@/components/BuildHopFeedbackWidget";
import { ConsentGatedTags } from "@/components/analytics/ConsentGatedTags";
import PageViewBeacon from "@/components/analytics/PageViewBeacon";
import AuthEventTracker from "@/components/analytics/AuthEventTracker";
import EngagementBeacon from "@/components/analytics/EngagementBeacon";
import MaintenanceWrapper from "@/components/MaintenanceWrapper";
import { ConsentWrapper } from "@/components/consent/ConsentWrapper";
import { AuthProvider } from "@/components/auth/AuthProvider";
import "@/app/globals.css";

// Dynamic import: moves SessionTracker + its dependencies (supabase, analytics, posthog/identify)
// to a separate chunk that loads after initial paint
const SessionTracker = dynamic(
  () => import("@/components/analytics/SessionTracker")
);
// AcquisitionCapture: first-touch channel bucket for ORGANIC arrivals, so
// users.acquisition_source stops being blind to everything except UTM-tagged
// partner links. Consent-gated inside the component; renders null.
const AcquisitionCapture = dynamic(
  () => import("@/components/analytics/AcquisitionCapture")
);
// NativeBoot: service-worker registration + Android back-button handler.
// Self-gates inside the Capacitor shell and on /trips/* paths — safe to
// always mount, costs ~0 on marketing pages.
const NativeBoot = dynamic(() => import("@/components/NativeBoot"));

export const metadata: Metadata = {
  // Core metadata
  title: {
    default: "Free AI Trip Planner | Day-by-Day Itineraries in Minutes",
    template: "%s | MonkeyTravel",
  },
  description: "Plan your perfect trip with AI-generated day-by-day itineraries. Get Budget, Balanced, and Premium options tailored to your travel style. Create personalized travel plans in minutes!",
  keywords: ["travel app", "trip planner", "AI travel", "itinerary generator", "vacation planning", "MonkeyTravel", "travel AI", "trip planning app", "smart travel planner", "personalized itinerary"],
  authors: [{ name: "MonkeyTravel" }],
  creator: "MonkeyTravel",
  publisher: "MonkeyTravel",

  // Canonical URL
  metadataBase: new URL("https://monkeytravel.app"),
  alternates: {
    canonical: "https://monkeytravel.app",
  },

  // Open Graph for social sharing (Facebook, LinkedIn, Teams, WhatsApp, etc.)
  //
  // When an explicit `openGraph` object is defined here, Next.js's file
  // convention (app/opengraph-image.tsx) doesn't auto-merge into it, and the
  // dynamic /opengraph-image routes 404 in production, so both og and
  // twitter point at the static /og-image.png (1200x630, served via /public).
  openGraph: {
    title: "MonkeyTravel - AI-Powered Trip Planning",
    description: "Plan trips in minutes with AI-generated day-by-day itineraries. Budget, Balanced, and Premium options tailored to your travel style.",
    url: "https://monkeytravel.app",
    siteName: "MonkeyTravel",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "MonkeyTravel - AI-Powered Trip Planning",
      },
    ],
  },

  // Twitter/X Card — same static image as og (intentional: single asset to
  // maintain, identical 1200x630 dimensions work for both).
  twitter: {
    card: "summary_large_image",
    title: "MonkeyTravel - AI-Powered Trip Planning",
    description: "Plan trips in minutes with AI-generated day-by-day itineraries",
    creator: "@monkeytravel",
    images: ["/og-image.png"],
  },

  // Icons configuration
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      // /apple-icon.png resolves to app/apple-icon.png via Next.js
      // file-conventions (the `.png` extension is preserved in the
      // generated route — verified on prod). We don't emit
      // /public/apple-touch-icon.png anymore.
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    other: [
      { rel: "icon", url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },

  // App manifest
  manifest: "/manifest.json",

  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  // Verification - Google Search Console
  verification: {
    google: "KJqVVN_ZJWViJBugcmfFkOLX-ZDgACGJQTOLt1l2Mvo",
  },

  // App links for mobile
  appleWebApp: {
    capable: true,
    title: "MonkeyTravel",
    statusBarStyle: "default",
  },

  // Format detection
  formatDetection: {
    telephone: false,
  },

  // Category
  category: "travel",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Generate global structured data schemas
const organizationSchema = generateOrganizationSchema();
const webSiteSchema = generateWebSiteSchema();
const softwareApplicationSchema = generateSoftwareApplicationSchema();

// Generate static params for all supported locales; any other locale is a
// 404 rather than a page rendered on demand.
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * The root layout of the site. It lives under [locale] so the locale is a
 * route param rather than something read from the request: that is what
 * lets the marketing pages prerender and serve from the CDN. Nothing in
 * here may read headers() or cookies(); app/admin has its own root layout.
 */
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

  // Client components on the marketing pages get only the namespaces they
  // read; the (app) route group's layout provides the whole catalog.
  const messages = await getMessages();

  // Consent Mode v2 default (everything denied) must be on the dataLayer
  // before gtag.js loads; see lib/analytics/ga-consent.ts and
  // components/analytics/ConsentGatedTags.tsx. Null when GA4 is unset or
  // NEXT_PUBLIC_GA_CONSENT_MODE=gated. The CSP admits it by hash.
  const gaConsentDefault = gaConsentDefaultScriptProps();

  // data-brand drives the doodle theme in globals.css: one attribute restyles
  // buttons, fields, pills and cards everywhere, so no component carries
  // brand-specific classes.
  return (
    <html lang={locale} data-brand={HERO_DOODLE_ENABLED ? "doodle" : undefined}>
      <head>
        {/* Global Structured Data (JSON-LD) for SEO */}
        <script {...jsonLdScriptProps(organizationSchema)} />
        <script {...jsonLdScriptProps(webSiteSchema)} />
        <script {...jsonLdScriptProps(softwareApplicationSchema)} />
        {gaConsentDefault ? <script {...gaConsentDefault} /> : null}

        {/* DNS prefetch for deferred third-party origins (preconnect removed —
            both scripts load after idle, so early connections expire unused) */}
        <link rel="dns-prefetch" href="https://emrldco.com" />
        <link rel="dns-prefetch" href="https://o4510503013122048.ingest.de.sentry.io" />
      </head>
      <body className={bodyFontClassName}>
        <NextIntlClientProvider messages={pickMessages(messages, MARKETING_CLIENT_NAMESPACES)} locale={locale}>
          <AuthProvider>
            {/*
             * Reads ?auth_event=... from the OAuth callback and fires the
             * signup/login analytics. It MUST live here, at the layout level,
             * not on a single page: app/auth/callback/route.ts computes
             * `next !== "/trips" ? next : "/trips/new"`, so a newly signed-up
             * user is redirected to whatever page the flow started from and
             * never to /trips. Suspense is required because the tracker
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
              <MaintenanceWrapper>{children}</MaintenanceWrapper>
            </ConsentWrapper>
          </AuthProvider>
        </NextIntlClientProvider>
        {/* Their scripts are served by Vercel only; elsewhere they 404. */}
        {process.env.VERCEL === "1" && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
        {/* Session tracking for retention analytics */}
        <SessionTracker />
        <PageViewBeacon />
        {/* First-touch acquisition channel (organic/referral/direct) */}
        <AcquisitionCapture />
        {/* Service worker (offline trips) + Android back-button handler */}
        <NativeBoot />
        {/* GA4 + the Travelpayouts affiliate loader, neither of which fires
            until the visitor has actually agreed to that category. See the
            component for the measurement and for why Sentry is not gated. */}
        <ConsentGatedTags />
        {/* BuildHop feedback widget — see components/BuildHopFeedbackWidget.tsx */}
        <BuildHopFeedbackWidget />
      </body>
    </html>
  );
}
