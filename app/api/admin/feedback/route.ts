import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/feedback
 *
 * Admin-only read of the demand-discovery survey responses (user_feedback).
 * Returns most-recent-first, capped at 500. The table is RLS-locked, so this
 * goes through the service-role client behind the admin gate.
 */
export async function GET() {
  const { errorResponse } = await getAuthenticatedAdmin();
  if (errorResponse) return errorResponse;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_feedback")
    .select(
      "id, user_id, source, uses_for, almost_stopped, last_booked_where, would_book_through_us, open_to_chat, contact_email, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[Admin Feedback] load failed:", error.message);
    return errors.internal("Failed to load feedback", "Admin Feedback");
  }

  const rows = data ?? [];
  const { count: totalCount } = await admin
    .from("user_feedback")
    .select("id", { count: "exact", head: true });
  const summary = {
    total: totalCount ?? rows.length,
    returned: rows.length,
    openToChat: rows.filter((r) => r.open_to_chat && r.contact_email).length,
    wouldBookYes: rows.filter((r) => r.would_book_through_us === "yes").length,
    wouldBookMaybe: rows.filter((r) => r.would_book_through_us === "maybe").length,
    wouldBookNo: rows.filter((r) => r.would_book_through_us === "no").length,
  };

  return apiSuccess({ feedback: rows, summary });
}
