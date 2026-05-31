import type { Metadata } from "next";
import TranslationsClient from "./TranslationsClient";

/**
 * Day-4 bug fix (P3.9): /admin/translations had no metadata export, so
 * the browser tab + Cmd-T search showed the root layout fallback —
 * "Free AI Trip Planner | Day-by-Day Itineraries in Minutes" — which
 * was the public homepage SEO title leaking onto an admin tools page.
 *
 * Sibling /admin/page.tsx already uses this server-wrapper pattern
 * (lines 6-11 there). Mirror it: server file owns the metadata,
 * delegates the actual UI to a sibling "use client" component.
 *
 * Admin gating is enforced by app/admin/layout.tsx (email whitelist),
 * so there's no per-route auth check needed here.
 */
export const metadata: Metadata = {
  title: "Translations Admin",
  description: "Edit MonkeyTravel translations across English, Spanish, and Italian.",
  robots: { index: false, follow: false },
};

export default function TranslationsPage() {
  return <TranslationsClient />;
}
