/**
 * Streaming day-object extractor for Gemini JSON output.
 *
 * Gemini returns the full itinerary as one JSON object:
 *   { "destination": {...}, "days": [{...}, {...}, ...] }
 *
 * We want to emit each complete day to the client as soon as it's done,
 * without waiting for the full response. The naive approach (try
 * JSON.parse on each chunk) doesn't work because the parser fails until
 * the entire object is present.
 *
 * APPROACH: brace-counting scan over the accumulated text buffer.
 *   - Wait until we've seen `"days":[` — the start of the days array
 *   - From that point, scan for balanced `{...}` objects at depth 1
 *     (depth 0 is the days array, depth 1 is each ItineraryDay object)
 *   - When a balanced object is found, JSON.parse it and emit
 *   - Track the consumed end-offset so we don't re-emit days on the next
 *     chunk
 *
 * The parser is INTENTIONALLY tolerant: malformed input doesn't throw,
 * it just doesn't emit. The caller falls back to parsing the full text
 * at stream completion as canonical truth. This means a parser bug
 * degrades to "no progressive UI" — not "broken generation".
 */

interface ParserState {
  buffer: string;
  // The byte offset at which we found `"days":[` — scanning starts here.
  daysArrayStart: number;
  // Offset PAST the last day object we already emitted.
  consumedUntil: number;
  // True once we've reached the `]` that closes the days array.
  daysArrayEnded: boolean;
}

export function createDayParser(): ParserState {
  return {
    buffer: "",
    daysArrayStart: -1,
    consumedUntil: -1,
    daysArrayEnded: false,
  };
}

/**
 * Feed a chunk into the parser. Returns the array of newly-completed day
 * objects (zero or more). The parser maintains internal state across
 * calls; never reset it manually.
 */
export function feedChunk(
  state: ParserState,
  chunk: string
): Array<Record<string, unknown>> {
  state.buffer += chunk;
  if (state.daysArrayEnded) return [];

  // 1. Find the start of the days array if we haven't yet. We look for
  //    `"days":[` (whitespace-tolerant via regex). Gemini occasionally
  //    formats it as `"days" : [` so we accept whitespace between tokens.
  if (state.daysArrayStart < 0) {
    const m = state.buffer.match(/"days"\s*:\s*\[/);
    if (!m || m.index === undefined) return [];
    state.daysArrayStart = m.index + m[0].length;
    state.consumedUntil = state.daysArrayStart;
  }

  // 2. Scan from consumedUntil, find balanced {...} objects at the array
  //    level. We track brace depth and string-mode (so a `{` inside a
  //    string literal doesn't count).
  const emitted: Array<Record<string, unknown>> = [];
  let i = state.consumedUntil;
  const buf = state.buffer;

  while (i < buf.length) {
    // Skip whitespace + commas between objects
    while (i < buf.length && /[\s,]/.test(buf[i])) i++;
    if (i >= buf.length) break;

    // If we hit `]` at this level, the days array is done.
    if (buf[i] === "]") {
      state.daysArrayEnded = true;
      state.consumedUntil = i + 1;
      break;
    }

    if (buf[i] !== "{") {
      // Unexpected char — give up on progressive parsing, let the final
      // full-text parse rescue us. Don't advance state so future chunks
      // also fail fast; the fallback path takes over.
      return emitted;
    }

    // Find the matching closing brace.
    const objEnd = findMatchingBrace(buf, i);
    if (objEnd < 0) {
      // Incomplete object — wait for more chunks.
      break;
    }

    const slice = buf.slice(i, objEnd + 1);
    try {
      const parsed = JSON.parse(slice) as Record<string, unknown>;
      emitted.push(parsed);
      state.consumedUntil = objEnd + 1;
      i = objEnd + 1;
    } catch {
      // Parse failed despite balanced braces — Gemini is mid-write of a
      // value (e.g. truncated string). Treat as incomplete and wait.
      break;
    }
  }

  return emitted;
}

/**
 * Scan from index `start` (which must point at `{`) and return the index
 * of the matching `}`. Respects JSON string escapes. Returns -1 if the
 * input runs out before a match is found.
 */
function findMatchingBrace(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Final-parse rescue: when the stream is complete, try to parse the
 * accumulated buffer as the full GeneratedItinerary JSON. Returns null
 * if it still doesn't parse — caller should treat as a hard failure
 * and emit an `error` SSE event.
 */
export function finalize(state: ParserState): unknown | null {
  try {
    return JSON.parse(state.buffer);
  } catch {
    return null;
  }
}
