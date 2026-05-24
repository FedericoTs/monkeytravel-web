/**
 * Browser-side SSE consumer for the streaming generation endpoint.
 *
 * We can't use the built-in EventSource API because:
 *   - EventSource is GET-only; our generation endpoint requires a POST body
 *   - EventSource lacks cookie-credentials control
 *
 * So we fetch() the streaming endpoint and parse the SSE wire format from
 * the response body manually. The parser is intentionally minimal — events
 * are always `event: <name>\ndata: <json>\n\n`. Multi-line data, comments,
 * and IDs (full SSE spec features) aren't used by our server, so we don't
 * parse them.
 */

import type {
  SseDayData,
  SseCompleteData,
  SseErrorData,
  SseMetadataData,
} from "./sse";

export interface StreamHandlers {
  onMetadata?: (data: SseMetadataData) => void;
  onDay?: (data: SseDayData) => void;
  onComplete: (data: SseCompleteData) => void;
  onError?: (data: SseErrorData) => void;
  /** Called once when the stream actually starts arriving (first byte). */
  onStart?: () => void;
}

/**
 * POST to the streaming endpoint and dispatch each SSE event to the
 * caller-supplied handlers. Resolves when the stream closes; rejects
 * if the connection fails before any data arrives (so the caller can
 * cleanly fall back to the JSON endpoint).
 */
export async function streamGeneration(
  body: unknown,
  handlers: StreamHandlers,
  options: { signal?: AbortSignal; url?: string } = {}
): Promise<void> {
  const url = options.url ?? "/api/ai/generate/stream";
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    // 4xx/5xx came back as JSON (pre-stream gate failed). Surface it as
    // a thrown error so the caller can fall back gracefully.
    let detail: string;
    try {
      const json = (await res.json()) as { error?: string };
      detail = json?.error || `HTTP ${res.status}`;
    } catch {
      detail = `HTTP ${res.status}`;
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (!res.body) {
    throw new Error("Streaming response had no body");
  }

  handlers.onStart?.();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE separates events with a blank line (\n\n). Split on that.
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        dispatchEvent(rawEvent, handlers);
      }
    }

    // Flush any trailing partial event (defensive — server should always
    // terminate with \n\n).
    if (buffer.trim().length > 0) {
      dispatchEvent(buffer, handlers);
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatchEvent(raw: string, handlers: StreamHandlers): void {
  // Two-line event: `event: <name>` then `data: <json>`. Order isn't
  // guaranteed by spec, so parse both lines and don't assume.
  let eventName = "message";
  let dataLine = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) {
      eventName = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLine = line.slice(6);
    }
  }
  if (!dataLine) return;

  let payload: unknown;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    // Malformed event — skip silently. The server-side error event
    // would also surface as a normal error path.
    return;
  }

  switch (eventName) {
    case "metadata":
      handlers.onMetadata?.(payload as SseMetadataData);
      break;
    case "day":
      handlers.onDay?.(payload as SseDayData);
      break;
    case "complete":
      handlers.onComplete(payload as SseCompleteData);
      break;
    case "error":
      handlers.onError?.(payload as SseErrorData);
      break;
    default:
      // Unknown event name — silently ignore for forward compatibility.
      break;
  }
}
