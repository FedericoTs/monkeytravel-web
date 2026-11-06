import type { NextRequest } from "next/server";
import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { readJsonBody } from "@/lib/api/json-body";
import { saveCreditReading } from "@/lib/ops/gemini-credit";

/** Google's largest single prepayment: more than this is a typo. */
const MAX_USD = 5000;

/** The Gemini balance AI Studio shows, typed on the Costs tab. */
export async function POST(request: NextRequest) {
  const { errorResponse } = await getAuthenticatedAdmin();
  if (errorResponse) return errorResponse;

  const { body, invalidBody } = await readJsonBody<{ usd?: unknown }>(request);
  if (invalidBody) return invalidBody;
  const { usd } = body;
  if (typeof usd !== "number" || !(usd >= 0 && usd <= MAX_USD)) {
    return errors.badRequest(`The balance must be a number of dollars from 0 to ${MAX_USD}`);
  }

  const reading = { usd, at: new Date().toISOString() };
  if (!(await saveCreditReading(reading))) return errors.internal("Failed to save the balance", "Admin Costs");
  return apiSuccess(reading);
}
