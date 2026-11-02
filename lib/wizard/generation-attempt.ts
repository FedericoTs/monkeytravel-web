import { GENERATION_ID_HEADER } from "@/lib/ai/generation-id";
import { streamGeneration } from "@/lib/streaming/client";
import type { SseDayData, SseOutlineData } from "@/lib/streaming/sse";
import type { GeneratedItinerary } from "@/types";
import { GENERATION_TIMEOUT_MS, postJsonWithTimeout, recoverGeneration } from "./generation-recovery";

/** A generation's answer: the plan, or why there is none. */
export type GenerationAnswer = {
  itinerary?: GeneratedItinerary;
  usage?: { used?: number; limit?: number };
  code?: string;
  error?: string;
  /** A signed-out planner reached the free-generation cap. */
  capped?: boolean;
};

/** Where a streamed generation reports its progress (the wizard's progress view). */
export interface GenerationProgress {
  reset: () => void;
  total: (days: number) => void;
  outline: (days: SseOutlineData["days"]) => void;
  day: (day: SseDayData) => void;
}

const DEFAULTS = {
  stream: streamGeneration,
  recover: recoverGeneration<GenerationAnswer>,
  postJson: postJsonWithTimeout<GenerationAnswer>,
  timeoutMs: GENERATION_TIMEOUT_MS,
};

/**
 * One try at a plan, under a generation id the server keeps the finished plan
 * under: a try whose answer never arrives is recovered by that id, else run
 * once more (generateWithRecovery).
 *
 * Streams first when the trip can stream (multi-city and anchored trips get
 * one merged JSON body instead); a stream that goes quiet for `timeoutMs` is
 * given up as lost. A stream cut once under way may still have finished on
 * the server, so its plan is asked for by id before generating again. Then
 * the JSON endpoint, which also answers when the stream failed before any
 * data (rate limit, Gemini off, network) or sent an `error` event mid-flight:
 * it has the cache and the limit gate, so only its own failure throws, with
 * the stream's error message when there was one.
 */
export async function attemptGeneration(
  generationId: string,
  request: { body: unknown; stream: boolean; signedIn: boolean },
  progress: GenerationProgress,
  deps: Partial<typeof DEFAULTS> = {}
): Promise<GenerationAnswer> {
  const { stream, recover, postJson, timeoutMs } = { ...DEFAULTS, ...deps };
  const headers = { [GENERATION_ID_HEADER]: generationId };
  progress.reset();

  // Annotated: TypeScript narrows a let assigned only inside callbacks to `never`.
  let streamed: GeneratedItinerary | null = null as GeneratedItinerary | null;
  let streamError: { error: string; code?: string } | null = null as { error: string; code?: string } | null;
  let streamStarted = false;
  if (request.stream) {
    const quiet = new AbortController();
    let quietTimer = setTimeout(() => quiet.abort(), timeoutMs);
    const heard = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => quiet.abort(), timeoutMs);
    };
    try {
      await stream(
        request.body,
        {
          onStart: () => {
            streamStarted = true;
            heard();
          },
          onMetadata: (meta) => {
            heard();
            progress.total(meta.totalDays);
          },
          onOutline: (outline) => {
            heard();
            progress.outline(outline.days);
          },
          onDay: (day) => {
            heard();
            // Shown as it arrives; the plan itself is `complete`'s sanitized,
            // image-enriched version.
            progress.day(day);
          },
          onComplete: (data) => {
            streamed = data.itinerary as GeneratedItinerary;
          },
          onError: (data) => {
            streamError = data;
          },
        },
        { headers, signal: quiet.signal }
      );
    } catch (err) {
      console.warn("[generate] streaming endpoint failed, falling back to JSON:", err);
    } finally {
      clearTimeout(quietTimer);
    }
  }
  if (streamed) return { itinerary: streamed };
  if (streamStarted && !streamError) {
    const kept = await recover(generationId, { attempts: 1 });
    if (kept) return kept;
  }

  const { response, data } = await postJson("/api/ai/generate", request.body, { headers, timeoutMs });
  if (!response.ok) {
    // The free-generation cap, refused by both endpoints.
    if (response.status === 429 && data.code === "RATE_LIMIT" && !request.signedIn) return { capped: true };
    throw new Error(streamError?.error || data.error || "Generation failed");
  }
  return data;
}
