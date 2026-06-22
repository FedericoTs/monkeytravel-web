import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { signFeedbackToken } from "@/lib/feedback/token";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/feedback/preview
 *
 * Admin-only test affordance. Mints a short-lived feedback token for the
 * signed-in admin and redirects to the real /feedback/[token] page, so the
 * tokenized email-link flow can be exercised end-to-end WITHOUT sending an
 * email. Non-admins (or signed-out) are bounced to the homepage.
 *
 * The token is signed with the same prod secret the real outreach links use,
 * so this is a faithful test of the production flow.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdmin(user.email)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // 1-day TTL — this is a disposable test link, not an outreach link.
  const token = signFeedbackToken(user.id, 1);
  return NextResponse.redirect(new URL(`/feedback/${token}`, request.url));
}
