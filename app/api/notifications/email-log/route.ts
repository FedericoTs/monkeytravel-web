import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/notifications/email-log?limit=20
 *
 * Returns recent email_log entries for the calling user, matched on
 * recipient_email = auth.users.email. RLS enforces this at the DB layer
 * (see migration 20260524) — the limit + ordering live here.
 *
 * Anonymous callers get an empty list (200) so the preference-center
 * page can mount unconditionally without auth-state branching.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return apiSuccess({ entries: [] });

    const limitRaw = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, limitRaw) : 20;

    // RLS filter (recipient_email = auth.users.email) makes the explicit
    // .eq("recipient_email", user.email) optional — but we add it as
    // defense in depth so a misconfigured policy doesn't leak rows.
    const { data, error } = await supabase
      .from("email_log")
      .select("id, recipient_email, template_id, status, sent_at, bounced_at, created_at, message_id")
      .eq("recipient_email", (user.email || "").toLowerCase())
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[email-log] read failed:", error.message);
      return errors.internal("Failed to load email history", "EmailLog");
    }
    return apiSuccess({ entries: data ?? [] });
  } catch (err) {
    return errors.internal(
      err instanceof Error ? err.message : "Failed",
      "EmailLog"
    );
  }
}
