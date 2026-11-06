import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJsonBody } from "@/lib/api/json-body";
import { apiSuccess, errors } from "@/lib/api/response-wrapper";
import { normalizeEmail } from "@/lib/participants/shared";
import { isKeptToken } from "@/lib/plans/kept-plan";
import { mayEmailKeptPlan, sendKeptPlanEmail, type PlanForEmail } from "@/lib/plans/kept-plan-email";

/**
 * POST /api/plans/<token>/email — send a kept plan's link to an address.
 * Body: { email, locale? }.
 *
 * An unknown or expired plan answers 404, like the plan's own route. A plan
 * that went to this address before, and an address that bounced, answer like a
 * send: the answer says nothing about the address.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { token } = await context.params;
  if (!isKeptToken(token)) return errors.notFound("No plan is kept under this link");

  const { body, invalidBody } = await readJsonBody<{ email?: unknown; locale?: unknown }>(request);
  if (invalidBody) return invalidBody;
  const email = normalizeEmail(body.email);
  if (!email) return errors.badRequest("That email address doesn't look right");

  if (!(await mayEmailKeptPlan(request, token, email))) {
    return errors.rateLimit("Too many emails for now. Try again later.");
  }

  const { data: plan, error } = await createAdminClient()
    .from("kept_plans")
    .select("start_date:plan->>startDate, end_date:plan->>endDate, name:plan->itinerary->destination->>name, destination:plan->>destination")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) {
    console.error("[plans] read for email failed:", error.message);
    return errors.internal("Could not send the email", "Plans");
  }
  if (!plan) return errors.notFound("No plan is kept under this link");

  const outcome = await sendKeptPlanEmail(plan as PlanForEmail, {
    token,
    email,
    locale: typeof body.locale === "string" ? body.locale.slice(0, 8) : null,
  });
  if (outcome === "failed" || outcome === "error") return errors.internal("Could not send the email", "Plans");
  return apiSuccess({ sent: true }, { headers: { "Cache-Control": "no-store" } });
}
