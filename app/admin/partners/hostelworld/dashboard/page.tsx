import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import HostelworldDashboard from "./HostelworldDashboard";

export const metadata: Metadata = {
  title: "Hostelworld Partner Dashboard",
  robots: { index: false, follow: false },
};

/**
 * /admin/partners/hostelworld/dashboard
 *
 * Internal report surface for the Hostelworld partner-sync conversation.
 * Shipped 2026-05-29 as Phase C of the Hostelworld partnership push (Phase
 * A = live counter on /backpacker, Phase B = UTM signup attribution).
 *
 * Mirrors the existing /admin auth pattern: server component, isAdmin(email)
 * gate, returns the dashboard client component with no per-user data —
 * just aggregate metrics fetched from /api/admin/partners/hostelworld/stats.
 *
 * Why a separate page (not a tab inside the main admin dashboard):
 *   - Partner-facing context: "I just sent N partners a screenshot of THIS"
 *   - Distinct refresh cadence + CSV export workflow
 *   - Future Phase C+ items (per-month breakdown, commission-owed estimate,
 *     reconciliation against Awin's own counts) all fit naturally here
 */
export default async function HostelworldPartnerDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?redirect=/admin/partners/hostelworld/dashboard");
  }
  if (!isAdmin(user.email)) {
    redirect("/");
  }

  return <HostelworldDashboard />;
}
