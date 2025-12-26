import { createClient } from "@/lib/supabase/server";
import { getEarlyAccessStatus } from "@/lib/early-access";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    const status = await getEarlyAccessStatus(user.id, user.email);

    return apiSuccess(status);
  } catch (error) {
    console.error("[EarlyAccess] Error getting status:", error);
    return errors.internal("Failed to get early access status", "EarlyAccess");
  }
}
