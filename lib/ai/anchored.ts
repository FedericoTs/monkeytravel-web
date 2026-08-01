/**
 * Anchored-trip generation orchestrator (F1 of docs/CONSTRAINT_PLANNER_PLAN.md).
 *
 * Reliability-first architecture, generalized from multi-city (lib/ai/
 * multi-city.ts): the pure core (anchors-core.ts) deterministically splits
 * the trip into locked days and fillable segments; each segment is generated
 * INDEPENDENTLY and in PARALLEL as a plain single-destination request over
 * its own sub-range, carrying a deterministic constraint brief; the results
 * are stitched back around the anchors by the pure merge.
 *
 * The LLM never sees the whole constraint problem — only "fill days X..Y,
 * you start near A, you must end near B, don't touch these slots". Global
 * correctness (anchors intact, dates sequential, geography) is enforced in
 * code, not hoped for in the prompt.
 *
 * COST (plan §6, binding): $0.00 of new Google spend. Segment generations
 * inherit the generation-time `maxPaidLookups: 0` invariant; a fully locked
 * trip makes ZERO model calls of any kind.
 */
import type { GeneratedItinerary, TripAnchor, TripCreationParams } from "@/types";
import { generateItinerary } from "@/lib/gemini";
import {
  type AnchorLayout,
  buildSegmentBrief,
  mergeAnchoredItinerary,
  segmentTrip,
  validateMergedItinerary,
} from "./anchors-core";

export { AnchorError, MAX_ANCHORS, validateAnchors } from "./anchors-core";

export interface AnchoredGenerationResult {
  itinerary: GeneratedItinerary;
  /**
   * Soft problems (merge degradations, end-near geography misses). Logged
   * for observability; a usable trip beats a hard fail.
   */
  issues: string[];
  layout: AnchorLayout;
}

/**
 * Generate an itinerary around fixed commitments. `params.anchors` must be
 * present and pre-validated by the route (validateAnchors) — segmentTrip
 * re-validates defensively and throws AnchorError on bad input.
 */
export async function generateAnchoredItinerary(
  params: TripCreationParams & { anchors: TripAnchor[] },
  options?: Parameters<typeof generateItinerary>[1]
): Promise<AnchoredGenerationResult> {
  const layout = segmentTrip(params.startDate, params.endDate, params.anchors);

  // Parallel per-segment generation: wall-clock = slowest segment, and each
  // small prompt has far less JSON-truncation risk than one long trip.
  // `anchors` is stripped from the per-segment params (the brief carries the
  // constraints); `anchorBrief` also keys the dedup cache so two segments or
  // two constraint revisions never coalesce.
  const results = await Promise.all(
    layout.segments.map((seg) =>
      generateItinerary(
        {
          ...params,
          anchors: undefined,
          startDate: seg.startDate,
          endDate: seg.endDate,
        },
        { ...options, anchorBrief: buildSegmentBrief(seg, layout.totalDays) }
      )
    )
  );

  const { itinerary, issues } = mergeAnchoredItinerary(layout, results, {
    destinationLabel: params.destination,
  });
  issues.push(...validateMergedItinerary(layout, itinerary));

  if (issues.length > 0) {
    // Warn, don't throw — same philosophy as multi-city's post-merge checks.
    console.warn(`[anchored] ${issues.length} merge/validation issue(s):`, issues);
  }

  return { itinerary, issues, layout };
}
