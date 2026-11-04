import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({
  wizardEvent: vi.fn(),
  ga4Generated: vi.fn(),
  started: vi.fn(),
  generated: vi.fn(),
  completed: vi.fn(),
  anchors: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@/components/wizard/wizardEvents", () => ({ trackWizardEvent: sent.wizardEvent }));
vi.mock("@/lib/analytics", () => ({ trackItineraryGenerated: sent.ga4Generated }));
vi.mock("@/lib/posthog/events", () => ({
  captureTripGenerationStarted: sent.started,
  captureItineraryGenerated: sent.generated,
  captureTripGenerationCompleted: sent.completed,
  captureAnchorsGenerated: sent.anchors,
  capture: sent.capture,
}));

import type { TripAnchor } from "@/types";
import {
  reportGenerated,
  reportGenerationAsks,
  reportGenerationFailed,
  reportGenerationLeft,
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

describe("reportGenerationLeft", () => {
  it("sends the funnel's abandoned row with how long the visitor waited, and nothing else", () => {
    reportGenerationLeft(report, 1_012_300);
    expect(rows()).toEqual([{ step: "abandoned", destination: "Lisbon, Portugal", locale: "it", elapsed_ms: 12_300 }]);
    expect(sent.completed).not.toHaveBeenCalled();
    expect(sent.generated).not.toHaveBeenCalled();
  });

  it("caps the wait at a day", () => {
    reportGenerationLeft(report, report.startedAt + 3 * 86_400_000);
    expect(rows()[0]).toMatchObject({ elapsed_ms: 86_400_000 });
  });
});

describe("reportGenerationAsks", () => {
  const anchor = (type: TripAnchor["type"], time_slot?: TripAnchor["time_slot"]) =>
    ({ id: type + (time_slot ?? ""), date: "2027-05-11", type, title: type, ...(time_slot ? { time_slot } : {}) }) as TripAnchor;
  const dates = { startDate: "2027-05-10", endDate: "2027-05-14" };

  it("counts an anchored request's fixed plans: how many, which kinds, how many all day, how many stays", () => {
    const anchors = [anchor("lodging"), anchor("event", "all_day"), anchor("event", "morning"), anchor("transport")];
    reportGenerationAsks({ anchored: true, anchors, mustDos: [], ...dates });
    expect(sent.anchors).toHaveBeenCalledWith({
      anchor_count: 4,
      anchor_types: ["lodging", "event", "transport"],
      all_day_count: 2,
      lodging_count: 1,
      trip_days: 5,
    });
    expect(sent.capture).not.toHaveBeenCalled();
  });

  it("counts the must-dos, and no fixed plans for a request that is not anchored", () => {
    reportGenerationAsks({ anchored: false, anchors: [anchor("lodging")], mustDos: ["Belém Tower", "Fado night"], ...dates });
    expect(sent.anchors).not.toHaveBeenCalled();
    expect(sent.capture).toHaveBeenCalledWith("must_dos_generated", { must_do_count: 2 });
  });

  it("sends nothing for a request with neither", () => {
    reportGenerationAsks({ anchored: false, anchors: [], mustDos: [], ...dates });
    expect(sent.anchors).not.toHaveBeenCalled();
    expect(sent.capture).not.toHaveBeenCalled();
  });
});
