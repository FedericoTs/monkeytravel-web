import type { BudgetTier } from "@/types";
import { trackItineraryGenerated } from "@/lib/analytics";
import { tripSpanDays } from "@/lib/dates/iso-date";
import {
  captureItineraryGenerated,
  captureTripGenerationCompleted,
  captureTripGenerationStarted,
  type TripIntent,
} from "@/lib/posthog/events";
import { trackWizardEvent } from "@/components/wizard/wizardEvents";
import { classifyGenerationFailure, failureDetail } from "@/lib/wizard/generation-failure";
import type { LostGenerationError } from "@/lib/wizard/generation-recovery";
import { funnelDays, funnelTraits } from "@/lib/wizard/plan-funnel";

/** A generation the wizard asked for, and the answers its reports carry. */
export interface GenerationReport {
  destination: string;
  startDate: string;
  endDate: string;
  budgetTier: BudgetTier;
  tripIntent: TripIntent;
  travelStyle: "classic" | "backpacker";
  locale: string;
  /** When the request went out (Date.now()); the timings run from here. */
  startedAt: number;
}

// A day: elapsed times past it are clocks gone wrong, not generations.
const MAX_ELAPSED_MS = 86_400_000;

/**
 * A generation set off: PostHog's trip_generation_started, with the intent so
 * its funnels can be read by solo or group, and the Supabase funnel's
 * `generating` row beside it.
 */
export function reportGenerationStarted(g: GenerationReport): void {
  captureTripGenerationStarted({
    destination: g.destination,
    duration_days: tripSpanDays(g.startDate, g.endDate),
    budget_tier: g.budgetTier,
    trip_intent: g.tripIntent,
  });
  void trackWizardEvent("generating", {
    ...funnelTraits(g),
    locale: g.locale,
    duration_days: funnelDays(g.startDate, g.endDate),
  });
}

/**
 * A generation answered. The Supabase funnel's `result` and `first_value`
 * rows (the "first magical output") only when there is an itinerary to show;
 * GA4's and PostHog's itinerary_generated and the activation funnel's
 * completion either way, timed from the start of this request.
 */
export function reportGenerated(g: GenerationReport, hasItinerary: boolean, now = Date.now()): void {
  if (hasItinerary) {
    const rowDays = funnelDays(g.startDate, g.endDate);
    void trackWizardEvent("result", { ...funnelTraits(g), locale: g.locale, duration_days: rowDays });
    void trackWizardEvent("first_value", { destination: g.destination, duration_days: rowDays, locale: g.locale });
  }
  const elapsed = now - g.startedAt;
  const spanDays = tripSpanDays(g.startDate, g.endDate);
  trackItineraryGenerated({
    destination: g.destination,
    duration: spanDays,
    budgetTier: g.budgetTier,
    generationTimeMs: Math.round(elapsed),
  });
  captureItineraryGenerated({
    destination: g.destination,
    duration_days: spanDays,
    budget_tier: g.budgetTier,
    generation_time_ms: Math.round(elapsed),
  });
  captureTripGenerationCompleted({
    destination: g.destination,
    duration_days: spanDays,
    budget_tier: g.budgetTier,
    generation_time_seconds: Math.round(elapsed / 1000),
    success: true,
    trip_intent: g.tripIntent,
  });
}

/**
 * A generation that failed. `abandoned` cannot follow `generating` (the
 * wizard counts as completed before the request goes out), so without the
 * `generation_failed` row a failed generation reads as someone closing the
 * tab; its failure_code separates the buckets without anyone reading a stack
 * trace, and request_id joins it to the server's row
 * (api_request_logs.request_params.generation_id). The activation funnel's
 * completion records it too.
 */
export function reportGenerationFailed(g: GenerationReport, err: unknown, now = Date.now()): void {
  const elapsed = now - g.startedAt;
  const failureCode = classifyGenerationFailure(err);
  const generationId = (err as LostGenerationError | null)?.generationId;
  void trackWizardEvent("generation_failed", {
    destination: g.destination,
    locale: g.locale,
    failure_code: failureCode,
    failure_detail: failureDetail(err, failureCode),
    ...(generationId ? { request_id: generationId } : {}),
    elapsed_ms: Math.min(elapsed, MAX_ELAPSED_MS),
  });
  captureTripGenerationCompleted({
    destination: g.destination,
    duration_days: tripSpanDays(g.startDate, g.endDate),
    budget_tier: g.budgetTier,
    generation_time_seconds: Math.round(elapsed / 1000),
    success: false,
    error_type: err instanceof Error ? err.message : "unknown",
    trip_intent: g.tripIntent,
  });
}
