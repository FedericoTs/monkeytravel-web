import { getAuthenticatedUser } from "@/lib/api/auth";
import { getEarlyAccessStatus } from "@/lib/early-access";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

export async function GET() {
  try {
    const { user, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const status = await getEarlyAccessStatus(user.id, user.email);

    return apiSuccess(status);
  } catch (error) {
    console.error("[EarlyAccess] Error getting status:", error);
    return errors.internal("Failed to get early access status", "EarlyAccess");
  }
}
