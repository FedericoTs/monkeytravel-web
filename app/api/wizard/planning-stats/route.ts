/**
 * Wizard Planning Stats API
 *
 * GET /api/wizard/planning-stats
 *
 * Returns an HONEST, aggregate social-proof number for the trip wizard:
 * how many DISTINCT planning sessions happened in the last 30 days.
 *
 * - Aggregate only. No PII, no per-user data — GDPR-safe.
 * - Backed by the service-role-only SECURITY DEFINER function
 *   get_wizard_planning_stats() (kept off the anon execute surface).
 * - Floored to a round number so the copy reads "1,000+" and never shows a
 *   fake-precise or embarrassingly small figure; returns null below a floor
 *   so the UI can simply hide the line rather than show weak proof.
 * - Cached in-memory for 1h — barely touches the DB.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { apiSuccess } from "@/lib/api/response-wrapper";

// Only surface the number once it's genuinely meaningful. Below this we return
// null and the wizard hides the social-proof line entirely (no weak "100+").
const MIN_MEANINGFUL = 300;

// Round DOWN to a "nice" honest floor: 1048 -> 1000, 640 -> 600, 340 -> 300.
function honestFloor(n: number): number {
  if (n >= 1000) return Math.floor(n / 1000) * 1000;
  return Math.floor(n / 100) * 100;
}

// Module-level cache (1h TTL).
let cached: { value: number | null; timestamp: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function GET() {
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return apiSuccess({ plannedLast30d: cached.value, cached: true });
  }

  let value: number | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_wizard_planning_stats");
    if (error) {
      console.error("[WizardStats] RPC error:", error.message);
    } else if (typeof data === "number" && data >= MIN_MEANINGFUL) {
      value = honestFloor(data);
    }
  } catch (err) {
    // Missing service-role creds (e.g. local without env) or any other
    // failure — degrade silently; the wizard just hides the line.
    console.error("[WizardStats] Failed to load planning stats:", err);
  }

  cached = { value, timestamp: Date.now() };
  return apiSuccess({ plannedLast30d: value, cached: false });
}
