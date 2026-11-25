/**
 * POST /api/experiments/exposure
 *
 * Records which arm of an experiment a browser saw, once per experiment and session
 * (lib/experiments/exposure.ts sends it when the arms first differ). Every visitor, whatever they chose in the
 * cookie banner: the experiment_exposures table is the record experiments are read from.
 *
 * The session is the mt_session_id cookie middleware sets; without one nothing is recorded. The experiment and the
 * arm must be one the registry knows. Rate-limited per IP and per session. 204 on success or when nothing is to be
 * recorded, 400 for an unknown experiment or arm, 429 over the limits, 500 when the write fails; the page ignores
 * all of them.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errors } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/json-body";
import { writesTelemetry } from "@/lib/analytics/telemetry-env";
import { experimentByKey } from "@/lib/experiments/registry";
import { createAdminClient } from "@/lib/supabase/admin";

const BodySchema = z.object({
  experiment: z.string().trim().min(1).max(40),
  arm: z.string().trim().min(1).max(30),
});

const ipLimiter = createRateLimiter("experiment-exposure-ip", 60, 60 * 1000);
const sessionLimiter = createRateLimiter("experiment-exposure-session", 20, 60 * 1000);

export async function POST(request: NextRequest) {
  const { body: raw, invalidBody } = await readJsonBody<unknown>(request);
  if (invalidBody) return invalidBody;

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return errors.badRequest("Invalid exposure", { issues: parsed.error.issues });
  }
  const experiment = experimentByKey(parsed.data.experiment);
  if (!experiment || !(experiment.arms as readonly string[]).includes(parsed.data.arm)) {
    return errors.badRequest("Unknown experiment or arm");
  }

  const sessionId = request.cookies.get("mt_session_id")?.value;
  if (!sessionId) return new NextResponse(null, { status: 204 });

  const ipCheck = await ipLimiter.check(request);
  if (!ipCheck.allowed) return errors.rateLimit("Too many exposures from this IP");
  const sessionCheck = await sessionLimiter.check(request, sessionId);
  if (!sessionCheck.allowed) return errors.rateLimit("Too many exposures for this session");

  if (!writesTelemetry(sessionId)) return new NextResponse(null, { status: 204 });

  const { error } = await createAdminClient()
    .from("experiment_exposures")
    .upsert(
      { experiment: experiment.key, arm: parsed.data.arm, session_id: sessionId.slice(0, 100) },
      { onConflict: "experiment,session_id", ignoreDuplicates: true },
    );
  if (error) {
    console.error("[experiment-exposure] insert failed:", error);
    return errors.internal("Failed to record the exposure", "experiment-exposure");
  }
  return new NextResponse(null, { status: 204 });
}
