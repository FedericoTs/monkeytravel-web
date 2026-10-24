import { type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { apiSuccess, errors } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { logApiCall } from "@/lib/api-gateway";
import { isGenerationId } from "@/lib/ai/generation-id";
import { findGeneration, generationOwner } from "@/lib/ai/generation-result";

/**
 * GET /api/ai/generate/result?id=<generation id>
 *
 * The plan a generation request finished under the id the wizard sent with it,
 * for a wizard that never received the answer (lib/ai/generation-result.ts).
 * 404 while nothing is kept for this id and browser: the server may still be
 * working, or the plan was never finished.
 */

export const dynamic = "force-dynamic";

const limiter = createRateLimiter("generation-result", 30, 60 * 1000);

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!isGenerationId(id)) return errors.badRequest("A generation id is required");
  if (!(await limiter.check(request)).allowed) return errors.rateLimit("Too many requests");

  const startTime = Date.now();
  const kept = await findGeneration(id.toLowerCase(), generationOwner(request));
  waitUntil(
    logApiCall({
      apiName: "generation_result",
      endpoint: "/api/ai/generate/result",
      status: kept ? 200 : 404,
      responseTimeMs: Date.now() - startTime,
      cacheHit: !!kept,
      costUsd: 0,
      metadata: { generation_id: id.toLowerCase() },
    }).catch(() => undefined)
  );
  if (!kept) return errors.notFound("No plan kept for this generation");
  return apiSuccess({ success: true, ...kept, recovered: true }, { headers: { "Cache-Control": "no-store" } });
}
