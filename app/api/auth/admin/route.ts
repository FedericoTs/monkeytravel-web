import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { apiSuccess } from "@/lib/api/response-wrapper";

/**
 * GET /api/auth/admin
 *
 * Whether the signed-in visitor is an admin, for the navbar's link to
 * /admin. Answered on the server so the admin list (lib/admin.ts) never
 * ships in a page's JavaScript. Personal, so never cached.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return apiSuccess({ admin: isAdmin(user?.email) }, { headers: { "Cache-Control": "private, no-store" } });
}
