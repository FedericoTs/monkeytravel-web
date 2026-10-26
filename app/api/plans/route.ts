import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { apiSuccess, errors } from "@/lib/api/response-wrapper";
import { keptPlanKeyHash, newKeptPlanSecrets, readKeptPlanBody } from "@/lib/plans/kept-plan-server";

/**
 * POST /api/plans — keep a signed-out planner's plan behind a private link
 * (lib/plans/kept-plan.ts). Answers the token for the link and the key that
 * lets this browser change the plan later; only the key's hash is stored.
 */

export const dynamic = "force-dynamic";

// Every plan made is kept, so this runs once per generation, which has its own
// tighter limits; the ceiling is for a caller using it as storage.
const limiter = createRateLimiter("kept-plans", 30, 60 * 60_000);

export async function POST(request: NextRequest) {
  if (!(await limiter.check(request)).allowed) {
    return errors.rateLimit("Too many plans kept from this connection. Try again later.");
  }
  const body = await readKeptPlanBody(request);
  if ("error" in body) return errors.badRequest(body.error);

  const { token, key } = newKeptPlanSecrets();
  const { data, error } = await createAdminClient()
    .from("kept_plans")
    .insert({
      token,
      key_hash: keptPlanKeyHash(key),
      plan: body.plan,
      session_id: request.cookies.get("mt_session_id")?.value?.slice(0, 100) ?? null,
    })
    .select("expires_at")
    .single();
  if (error || !data) {
    console.error("[plans] keep failed:", error?.message);
    return errors.internal("Could not keep the plan", "Plans");
  }
  return apiSuccess(
    { token, key, expiresAt: data.expires_at },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
