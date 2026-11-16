import { NextRequest } from "next/server";
import { apiSuccess, errors } from "@/lib/api/response-wrapper";
import { readJsonBody } from "@/lib/api/json-body";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { readCoordinates } from "@/lib/ai/daylight";
import { searchStays } from "@/lib/places/stay-search";
import { STAY_NAME_MAX } from "@/lib/trips/stay";

/**
 * POST /api/places/stay-search { input, near: { latitude, longitude }, locale }
 *
 * Suggestions for step 1's "Where are you staying?": hotels, streets and areas
 * near the destination, from OpenStreetMap through Photon. Free, and a
 * suggestion is only a convenience: the field takes free text as well.
 */

// Typing searches about once a keystroke pause; 60 a minute per address keeps a
// person typing well inside it and a script out of Photon's way.
const staySearchLimiter = createRateLimiter("stay-search", 60, 60 * 1000);

export async function POST(request: NextRequest) {
  const { body, invalidBody } = await readJsonBody<Record<string, unknown>>(request);
  if (invalidBody) return invalidBody;

  const input = typeof body.input === "string" ? body.input.trim() : "";
  const near = readCoordinates(body.near);
  if (input.length < 3 || input.length > STAY_NAME_MAX || !near) {
    return apiSuccess({ places: [] });
  }

  const { allowed } = await staySearchLimiter.check(request);
  if (!allowed) return errors.rateLimit("Too many searches — please wait a moment.");

  const locale = typeof body.locale === "string" ? body.locale : undefined;
  return apiSuccess({ places: await searchStays(input, near, locale) });
}
