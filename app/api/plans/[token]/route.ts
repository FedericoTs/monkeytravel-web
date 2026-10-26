import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { apiSuccess, errors } from "@/lib/api/response-wrapper";
import { isKeptToken } from "@/lib/plans/kept-plan";
import { keptPlanKeyHash, readKeptPlanBody } from "@/lib/plans/kept-plan-server";

/**
 * GET /api/plans/<token> — open a kept plan: counted, kept 30 more days.
 * PUT /api/plans/<token> — change it, with the key the keeping browser holds
 * (header x-plan-key).
 *
 * Unknown, expired and wrong-key plans all answer 404, so the answer says
 * nothing about which tokens exist.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

const openLimiter = createRateLimiter("kept-plans-open", 60, 60_000);
// A planner's edits are sent a few seconds apart, after they settle.
const changeLimiter = createRateLimiter("kept-plans-change", 120, 60 * 60_000);

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, context: Context) {
  const { token } = await context.params;
  if (!isKeptToken(token)) return errors.notFound("No plan is kept under this link");
  if (!(await openLimiter.check(request)).allowed) return errors.rateLimit("Too many requests");

  const { data, error } = await createAdminClient().rpc("open_kept_plan", { p_token: token });
  if (error) {
    console.error("[plans] open failed:", error.message);
    return errors.internal("Could not open the plan", "Plans");
  }
  if (!data) return errors.notFound("No plan is kept under this link");
  const { plan, expires_at } = data as { plan: unknown; expires_at: string };
  return apiSuccess({ plan, expiresAt: expires_at }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest, context: Context) {
  const { token } = await context.params;
  const key = request.headers.get("x-plan-key");
  if (!isKeptToken(token) || !key || key.length > 100) return errors.notFound("No plan is kept under this link");
  if (!(await changeLimiter.check(request, token)).allowed) return errors.rateLimit("Too many changes");

  const body = await readKeptPlanBody(request);
  if ("error" in body) return errors.badRequest(body.error);

  const now = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from("kept_plans")
    .update({ plan: body.plan, updated_at: now })
    .eq("token", token)
    .eq("key_hash", keptPlanKeyHash(key))
    .gt("expires_at", now)
    .select("expires_at")
    .maybeSingle();
  if (error) {
    console.error("[plans] change failed:", error.message);
    return errors.internal("Could not change the plan", "Plans");
  }
  if (!data) return errors.notFound("No plan is kept under this link");
  return apiSuccess({ expiresAt: data.expires_at }, { headers: NO_STORE });
}
