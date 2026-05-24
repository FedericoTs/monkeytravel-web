/**
 * Tiny Server-Sent Events writer for streaming generation.
 *
 * Why SSE and not JSON-lines or WebSockets:
 *   - SSE works over HTTP/2 + standard fetch — no proxy upgrade dance
 *   - Built-in event-name + ID semantics (we use the name; ID unused)
 *   - Vercel edge respects `Cache-Control: no-cache, no-transform` and
 *     leaves the stream alone if you also set `X-Accel-Buffering: no`
 *
 * The wire format is intentionally minimal: an event line + a data line +
 * a blank line, per the SSE spec. Each event's data is single-line JSON.
 *
 * Used by /api/ai/generate/stream — see .audit/implementation-plans.md §4.
 */

export type SseEvent =
  | { type: "metadata"; data: SseMetadataData }
  | { type: "day"; data: SseDayData }
  | { type: "complete"; data: SseCompleteData }
  | { type: "error"; data: SseErrorData };

export interface SseMetadataData {
  destination: { name: string; country: string };
  totalDays: number;
  language: string;
  /** "stream" or "cache" — cache hits send all days under one complete event. */
  mode: "stream" | "cache";
}

export interface SseDayData {
  day_number: number;
  date: string;
  title?: string;
  theme?: string;
  // The full ItineraryDay shape; intentionally loose to avoid coupling
  // the SSE writer to the application's evolving day schema.
  [key: string]: unknown;
}

export interface SseCompleteData {
  itinerary: unknown; // full GeneratedItinerary
  meta: {
    generationTimeMs: number;
    model: string;
    cached: boolean;
    generatedDays: number;
    totalDays: number;
    costUsd: number;
  };
  usage?: unknown;
}

export interface SseErrorData {
  error: string;
  /** Optional discriminator for client-side branching. */
  code?: "rate_limit" | "auth" | "validation" | "upstream" | "internal";
}

/**
 * Format one SSE message line per the spec. Always terminates with a
 * blank line so the reader's "message" boundary is unambiguous.
 *
 * NOTE: the spec uses LF (\n), not CRLF. Some HTTP libraries auto-convert;
 * Vercel + Next don't, so we stick with LF.
 */
export function formatSseEvent(event: SseEvent): string {
  // Stringify defensively — if data has cycles, fall back to error event.
  let payload: string;
  try {
    payload = JSON.stringify(event.data);
  } catch {
    payload = JSON.stringify({ error: "Failed to serialize event" });
  }
  return `event: ${event.type}\ndata: ${payload}\n\n`;
}

/**
 * Standard headers for the streaming response. Apply to a ReadableStream
 * via `new Response(stream, { headers: sseHeaders() })`.
 *
 * Critical:
 *   - text/event-stream: signals to the browser this is SSE
 *   - no-cache + no-transform: defeats CDN compression which would buffer
 *   - X-Accel-Buffering: no — disables nginx/Vercel buffering specifically
 *   - Connection keep-alive is implicit in HTTP/1.1; HTTP/2 has no equivalent
 *     concept but Vercel handles it
 */
export function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  };
}

/**
 * Convenience: build a `ReadableStream<Uint8Array>` from an async generator
 * of SSE events. Wraps each yielded event with formatSseEvent and TextEncoder.
 *
 * Errors thrown from the generator are caught and emitted as an `error`
 * event before the stream closes, so the client always sees a terminal
 * event (never an abrupt close).
 */
export function eventStreamFromGenerator(
  events: AsyncGenerator<SseEvent, void, unknown>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Stream generator threw";
        controller.enqueue(
          encoder.encode(
            formatSseEvent({
              type: "error",
              data: { error: message, code: "internal" },
            })
          )
        );
      } finally {
        controller.close();
      }
    },
  });
}
