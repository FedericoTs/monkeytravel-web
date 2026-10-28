/**
 * POST /api/images/landmarks — { destination, names } → { photos }
 *
 * The Wikimedia photos found for a plan's places since it was shown. A plan
 * being generated has its places looked up in the background
 * (lib/images/activity.ts); the planner asks here a few seconds later and
 * swaps them in for its stock images. Reads the shared cache only: nothing is
 * looked up or written here. `photos[i]` answers `names[i]`, or is null.
 */

import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { normalizeActivityKey } from "@/lib/images/activity";
import { cachedLandmarkPhotos } from "@/lib/images/landmark-photos";

const limiter = createRateLimiter("landmark-photos", 60, 60_000);

const MAX_NAMES = 80;
const MAX_LENGTH = 200;

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_LENGTH;

export async function POST(request: NextRequest) {
  const { allowed } = await limiter.check(request);
  if (!allowed) return errors.rateLimit();

  let body: { destination?: unknown; names?: unknown };
  try {
    body = await request.json();
  } catch {
    return errors.badRequest("Invalid JSON");
  }
  const { destination, names } = body;
  if (!isText(destination) || !Array.isArray(names) || names.length === 0 || names.length > MAX_NAMES || !names.every(isText)) {
    return errors.badRequest(`A destination and 1-${MAX_NAMES} names are required`);
  }

  const keys = names.map((name) => normalizeActivityKey(name, destination));
  const found = await cachedLandmarkPhotos([...new Set(keys)]);
  return apiSuccess(
    { photos: keys.map((key) => found.get(key) ?? null) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
