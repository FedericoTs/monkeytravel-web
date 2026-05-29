import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Locale-aware <title> for /trips/new.
 *
 * The wizard page itself is `"use client"` (heavy interactive component)
 * so it can't export `metadata` directly. This layout sits next to it,
 * stays server-rendered, and provides per-locale metadata that wins
 * over the root layout's default ("Free AI Trip Planner | …").
 *
 * Before this file existed, every locale tab read "Free AI Trip Planner —
 * Day-by-Day Itineraries in Minutes" — caught in audit 2026-05-29
 * because the /it/ wizard's body was already Italian.
 *
 * robots: noindex because the wizard is a private interactive surface,
 * not a marketing landing page. The locale-aware version of THAT story
 * lives at /[locale]/free-ai-trip-planner.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.buttons" });
  return {
    title: t("planTrip"),
    robots: { index: false, follow: false },
  };
}

export default function TripsNewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
