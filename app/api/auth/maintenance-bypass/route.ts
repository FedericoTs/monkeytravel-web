import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { apiSuccess } from "@/lib/api/response-wrapper";

/**
 * GET /api/auth/maintenance-bypass
 *
 * Per-user maintenance-mode bypass check, computed SERVER-SIDE so the
 * admin email allowlist (lib/admin.ts) never ships in a client bundle.
 * Previously MaintenanceWrapper imported isAdmin() client-side, which
 * put the three admin emails in every page's JS (the wrapper mounts in
 * the root layout).
 *
 * Called by MaintenanceWrapper ONLY when maintenance_mode is on — the
 * common path (maintenance off) never hits this route, so no caching
 * is needed and the response can be personalized.
 *
 * Bypass is granted to: admins, emails on site_config.allowed_emails,
 * and users with unexpired tester access. Any individual lookup error
 * degrades to "no bypass from this rule" — the wrapper's own fetch
 * catch preserves the historical global fail-open (never lock everyone
 * out on infra failure).
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return apiSuccess({ bypass: false });

  if (isAdmin(user.email)) return apiSuccess({ bypass: true });

  try {
    const { data: config } = await supabase
      .from("site_config")
      .select("allowed_emails")
      .eq("id", 1)
      .single();
    const allowed: string[] = (config?.allowed_emails || []).map((e: string) =>
      e.toLowerCase(),
    );
    if (user.email && allowed.includes(user.email.toLowerCase())) {
      return apiSuccess({ bypass: true });
    }
  } catch {
    /* fall through to tester check */
  }

  try {
    const { data: tester } = await supabase
      .from("user_tester_access")
      .select("id, expires_at")
      .eq("user_id", user.id)
      .single();
    if (
      tester &&
      (!tester.expires_at || new Date(tester.expires_at) >= new Date())
    ) {
      return apiSuccess({ bypass: true });
    }
  } catch {
    /* no tester access */
  }

  return apiSuccess({ bypass: false });
}
