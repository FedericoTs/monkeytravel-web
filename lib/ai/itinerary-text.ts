import type { GeneratedItinerary, TripCreationParams } from "@/types";
import { validateAndFixCoordinates } from "@/lib/trip/coordinate-fallback";
import { withServerFields } from "@/lib/ai/server-fields";
import { mendJson } from "@/lib/ai/json-mend";

/**
 * The model's itinerary text as a plan: a truncated reply repaired, a missing
 * trip summary backfilled, and a streamed reply checked and finished the way
 * a blocking one is. No model call here.
 */

/**
 * Backfill a missing or partial trip_summary so downstream consumers
 * (wizard render, persistTrip) don't crash when the model truncates the
 * response before emitting the summary block: tryRepairTruncatedJSON can
 * recover valid `days` with no trailing trip_summary. Safe defaults let the
 * UI render; users can edit the budget after save.
 *
 * Mutates the input and returns it.
 */
function ensureTripSummary(itinerary: GeneratedItinerary): GeneratedItinerary {
  const existing = (itinerary as { trip_summary?: Partial<GeneratedItinerary["trip_summary"]> })
    .trip_summary;
  itinerary.trip_summary = {
    total_estimated_cost:
      typeof existing?.total_estimated_cost === "number" ? existing.total_estimated_cost : 0,
    currency: typeof existing?.currency === "string" ? existing.currency : "USD",
    highlights: Array.isArray(existing?.highlights) ? existing.highlights : [],
    packing_suggestions: Array.isArray(existing?.packing_suggestions)
      ? existing.packing_suggestions
      : [],
  };
  return itinerary;
}

/**
 * Attempt to repair truncated/malformed JSON from Gemini.
 *
 * A response that hits maxOutputTokens mid-string or mid-array is broken
 * JSON, and retries don't help — same prompt + same cap = same truncation.
 * Better to recover a shorter-but-valid itinerary than 500 the user.
 *
 * Strategy: walk char-by-char tracking string state and bracket depth.
 * If we end inside a string or with unclosed structures, close them in
 * reverse order. Returns null when the brackets already balance (the parse
 * error is something else) or when structure is too broken to safely
 * recover (mismatched brackets etc).
 *
 * Trade-off: a "repaired" itinerary may be missing the last day(s) or
 * have a truncated final activity; validateAndFixCoordinates() and
 * ensureTripSummary() backfill defaults. Callers log a Sentry breadcrumb
 * per repair so the frequency stays visible.
 */
function tryRepairTruncatedJSON(raw: string): string | null {
  // Strip markdown code fences if Gemini added them despite our instructions.
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  if (!s) return null;

  let inString = false;
  let escape = false;
  const stack: string[] = []; // tracks '{' and '['
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}") {
      if (stack[stack.length - 1] !== "{") return null; // mismatched
      stack.pop();
    } else if (c === "]") {
      if (stack[stack.length - 1] !== "[") return null; // mismatched
      stack.pop();
    }
  }
  // Already balanced — nothing to repair (parse error must be something else).
  if (stack.length === 0 && !inString) return null;

  let repaired = s;
  // Drop trailing escape backslash so we don't end with "\
  if (repaired.endsWith("\\")) repaired = repaired.slice(0, -1);
  // Close unterminated string.
  if (inString) repaired += '"';
  // Strip dangling comma / colon / partial key before adding closers.
  repaired = repaired.replace(/[,:\s]+$/, "");
  // If we stripped down to a dangling key like "foo" — strip the orphan key+separator.
  // Keep stripping orphans: `, "key"` -> remove ", \"key\"" suffix patterns.
  repaired = repaired.replace(/,\s*"[^"]*"\s*$/, "");
  // Close all open brackets in reverse order.
  while (stack.length > 0) {
    const open = stack.pop();
    repaired += open === "{" ? "}" : "]";
  }
  return repaired;
}

/**
 * Validate the streamed itinerary JSON and apply the post-processing
 * the non-streaming path does (coordinate fixing). Returns the cleaned
 * GeneratedItinerary or throws on parse/validation failure.
 */
export function parseStreamedItinerary(
  fullText: string,
  params: TripCreationParams
): GeneratedItinerary {
  // Mirror the repair-on-truncation behaviour from generateItineraryInternal.
  const validate = (obj: GeneratedItinerary): GeneratedItinerary => {
    if (!obj.destination || !obj.days || obj.days.length === 0) {
      throw new Error("Invalid itinerary structure");
    }
    obj.days = validateAndFixCoordinates(obj.days, params.destination);
    ensureTripSummary(obj);
    return withServerFields(obj, params);
  };
  try {
    // A slip mid-reply (an unescaped quote, a missing comma) is mended rather
    // than costing the traveller a second plan.
    const { value, mends } = mendJson(fullText);
    const itinerary = validate(value as GeneratedItinerary);
    if (mends > 0) console.warn(`[gemini.streamed] mended ${mends} slip(s) in the model's JSON for "${params.destination}".`);
    return itinerary;
  } catch (e) {
    const repaired = tryRepairTruncatedJSON(fullText);
    if (repaired) {
      try {
        const obj = validate(JSON.parse(repaired) as GeneratedItinerary);
        const msg =
          `[gemini.streamed] tryRepairTruncatedJSON recovered a ${obj.days.length}-day ` +
          `itinerary for "${params.destination}" (stream ${fullText.length} chars).`;
        console.warn(msg);
        // Breadcrumb only — captureMessage(warning) creates noisy Sentry
        // issues. We want the signal in attached events but not as
        // standalone issues.
        import("@sentry/nextjs")
          .then((Sentry) => {
            Sentry.addBreadcrumb?.({
              category: "gemini.streamed.repair",
              message: msg,
              level: "info",
              data: { destination: params.destination, days: obj.days.length, stream_chars: fullText.length },
            });
          })
          .catch(() => {});
        return obj;
      } catch {
        /* fall through to original error */
      }
    }
    throw e;
  }
}

export { ensureTripSummary, tryRepairTruncatedJSON };
