import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({
  wizardEvent: vi.fn(),
  ga4Generated: vi.fn(),
  started: vi.fn(),
  generated: vi.fn(),
  completed: vi.fn(),
}));
vi.mock("@/components/wizard/wizardEvents", () => ({ trackWizardEvent: sent.wizardEvent }));
vi.mock("@/lib/analytics", () => ({ trackItineraryGenerated: sent.ga4Generated }));
vi.mock("@/lib/posthog/events", () => ({
  captureTripGenerationStarted: sent.started,
  captureItineraryGenerated: sent.generated,
  captureTripGenerationCompleted: sent.completed,
}));

import {
  reportGenerated,
  reportGenerationFailed,
  reportGenerationStarted,
  type GenerationReport,
} from "./generation-reports";

const report: GenerationReport = {
  destination: "Lisbon, Portugal",
  startDate: "2027-05-10",
  endDate: "2027-05-14",
  budgetTier: "balanced",
  tripIntent: "group",
  travelStyle: "backpacker",
  locale: "it",
  startedAt: 1_000_000,
};
const rows = () => sent.wizardEvent.mock.calls.map(([step, row]) => ({ step, ...row }));

beforeEach(() => Object.values(sent).forEach((fn) => fn.mockClear()));

describe("reportGenerationStarted", () => {
  it("sends PostHog's start, with the intent, and the funnel's generating row", () => {
    reportGenerationStarted(report);
    expect(sent.started).toHaveBeenCalledWith({
      destination: "Lisbon, Portugal",
      duration_days: 5,
      budget_tier: "balanced",
      trip_intent: "group",
    });
    expect(rows()).toEqual([
      {
        step: "generating",
        destination: "Lisbon, Portugal",
        group_size: "group",
        backpacker_mode: true,
        locale: "it",
        duration_days: 5,
      },
    ]);
  });
});

describe("reportGenerated", () => {
  it("sends the funnel's result and first value, and the generation everywhere it is counted", () => {
    reportGenerated(report, true, 1_012_345);
    expect(rows()).toEqual([
      {
        step: "result",
        destination: "Lisbon, Portugal",
        group_size: "group",
        backpacker_mode: true,
        locale: "it",
        duration_days: 5,
      },
      { step: "first_value", destination: "Lisbon, Portugal", duration_days: 5, locale: "it" },
    ]);
    expect(sent.ga4Generated).toHaveBeenCalledWith({
      destination: "Lisbon, Portugal",
      duration: 5,
      budgetTier: "balanced",
      generationTimeMs: 12_345,
    });
    expect(sent.generated).toHaveBeenCalledWith({
      destination: "Lisbon, Portugal",
      duration_days: 5,
      budget_tier: "balanced",
      generation_time_ms: 12_345,
    });
    expect(sent.completed).toHaveBeenCalledWith({
      destination: "Lisbon, Portugal",
      duration_days: 5,
      budget_tier: "balanced",
      generation_time_seconds: 12,
      success: true,
      trip_intent: "group",
    });
  });

  it("leaves the funnel's rows out when there is no itinerary to show", () => {
    reportGenerated(report, false, 1_012_345);
    expect(rows()).toEqual([]);
    expect(sent.generated).toHaveBeenCalledTimes(1);
    expect(sent.completed).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe("reportGenerationFailed", () => {
  it("sends the failure's bucket, its words and the generation it joins to", () => {
    const err = Object.assign(new Error('Destination "Narnia" is not a place we know'), { generationId: "gen-1" });
    reportGenerationFailed(report, err, 1_004_600);
    expect(rows()).toEqual([
      {
        step: "generation_failed",
        destination: "Lisbon, Portugal",
        locale: "it",
        failure_code: "unknown",
        failure_detail: 'Destination "" is not a place we know',
        request_id: "gen-1",
        elapsed_ms: 4_600,
      },
    ]);
    expect(sent.completed).toHaveBeenCalledWith({
      destination: "Lisbon, Portugal",
      duration_days: 5,
      budget_tier: "balanced",
      generation_time_seconds: 5,
      success: false,
      error_type: 'Destination "Narnia" is not a place we know',
      trip_intent: "group",
    });
  });

  it("caps the elapsed time at a day, and names a thrown non-error unknown", () => {
    reportGenerationFailed(report, "Failed to fetch", report.startedAt + 3 * 86_400_000);
    expect(rows()).toEqual([
      {
        step: "generation_failed",
        destination: "Lisbon, Portugal",
        locale: "it",
        failure_code: "network",
        failure_detail: undefined,
        elapsed_ms: 86_400_000,
      },
    ]);
    expect(sent.completed).toHaveBeenCalledWith(expect.objectContaining({ error_type: "unknown", success: false }));
  });
});
