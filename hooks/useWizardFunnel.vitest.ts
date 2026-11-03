import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const trackWizardEvent = vi.fn();
const stepViewed = vi.fn();
const fieldTouched = vi.fn();
const abandoned = vi.fn();
vi.mock("@/components/wizard/wizardEvents", () => ({
  trackWizardEvent: (...a: unknown[]) => trackWizardEvent(...a),
  landingAttribution: () => ({ referrer: "example.com/blog" }),
}));
vi.mock("@/lib/posthog/events", () => ({
  captureTripWizardStepViewed: (...a: unknown[]) => stepViewed(...a),
  captureTripWizardFieldInteracted: (...a: unknown[]) => fieldTouched(...a),
  captureTripWizardAbandoned: (...a: unknown[]) => abandoned(...a),
}));

import { useWizardFunnel } from "./useWizardFunnel";

type Props = Parameters<typeof useWizardFunnel>[0];
const props = (over: Partial<Props> = {}): Props => ({
  step: 1,
  entryResolved: true,
  locale: "en",
  tripIntent: "unspecified",
  travelStyle: "classic",
  destination: "",
  startDate: "",
  endDate: "",
  vibes: [],
  ...over,
});
const rows = (step: string) => trackWizardEvent.mock.calls.filter(([s]) => s === step).map(([, extra]) => extra);

beforeEach(() => {
  vi.useFakeTimers();
  [trackWizardEvent, stepViewed, fieldTouched, abandoned].forEach((fn) => fn.mockClear());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useWizardFunnel", () => {
  it("records each step's view once the auth state is known, and once per step", () => {
    const { rerender } = renderHook((p: Props) => useWizardFunnel(p), { initialProps: props({ entryResolved: false }) });
    expect(trackWizardEvent).not.toHaveBeenCalled();
    rerender(props());
    expect(rows("step_1_destination_dates")).toEqual([{ locale: "en", referrer: "example.com/blog" }]);
    rerender(props({ step: 2, destination: "Lisbon, Portugal", startDate: "2027-05-10", endDate: "2027-05-14", tripIntent: "group", travelStyle: "backpacker" }));
    rerender(props({ step: 1 }));
    rerender(props({ step: 2 }));
    expect(rows("step_1_destination_dates")).toHaveLength(1);
    expect(stepViewed.mock.calls.map(([e]) => e.step_name)).toEqual(["destination_dates", "vibes_preferences", "destination_dates", "vibes_preferences"]);
    expect(rows("step_2_vibes")).toHaveLength(1);
  });

  it("describes the trip on the step-2 view as it stood when step 1 was left", () => {
    const { rerender } = renderHook((p: Props) => useWizardFunnel(p), { initialProps: props() });
    const trip = { destination: "Lisbon, Portugal", startDate: "2027-05-10", endDate: "2027-05-14" };
    rerender(props(trip));
    rerender(props({ ...trip, step: 2, tripIntent: "group", travelStyle: "backpacker" }));
    expect(rows("step_2_vibes")).toEqual([
      { destination: "Lisbon, Portugal", duration_days: 5, group_size: "group", backpacker_mode: true, locale: "en" },
    ]);
  });

  it("records a field's first touch on each step, and keeps a stable function", () => {
    const { result, rerender } = renderHook((p: Props) => useWizardFunnel(p), { initialProps: props() });
    const first = result.current.trackFieldInteraction;
    act(() => {
      result.current.trackFieldInteraction("destination_pill");
      result.current.trackFieldInteraction("destination_pill");
    });
    rerender(props({ step: 2 }));
    expect(result.current.trackFieldInteraction).toBe(first);
    act(() => result.current.trackFieldInteraction("destination_pill"));
    expect(fieldTouched.mock.calls.map(([e]) => [e.step_number, e.field])).toEqual([
      [1, "destination_pill"],
      [2, "destination_pill"],
    ]);
  });

  it("reports how far an engaged session got when the page goes, once", () => {
    const { result, rerender } = renderHook((p: Props) => useWizardFunnel(p), { initialProps: props() });
    act(() => result.current.trackFieldInteraction("destination_autocomplete"));
    rerender(props({ destination: "Lisbon, Portugal", startDate: "2027-05-10", endDate: "2027-05-11" }));
    vi.advanceTimersByTime(42_000);
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("beforeunload"));
    expect(rows("abandoned")).toEqual([
      {
        destination: "Lisbon, Portugal",
        duration_days: 2,
        locale: "en",
        last_step: "step_1_destination_dates",
        last_touched_field: "destination_autocomplete",
        total_time_seconds: 42,
      },
    ]);
    expect(abandoned).toHaveBeenCalledWith(
      expect.objectContaining({ last_step_completed: 0, had_destination: true, had_dates: true, had_vibes: false })
    );
  });

  it("stays quiet for a visit that touched nothing on step 1", () => {
    const { unmount } = renderHook((p: Props) => useWizardFunnel(p), { initialProps: props() });
    window.dispatchEvent(new Event("pagehide"));
    unmount();
    expect(rows("abandoned")).toEqual([]);
    expect(abandoned).not.toHaveBeenCalled();
  });

  it("doesn't report a planner who generated, even when the page goes", () => {
    const { result, unmount } = renderHook((p: Props) => useWizardFunnel(p), { initialProps: props({ step: 2 }) });
    act(() => result.current.markCompleted());
    window.dispatchEvent(new Event("pagehide"));
    unmount();
    expect(rows("abandoned")).toEqual([]);
  });

  it("reports when the wizard unmounts mid-flow", () => {
    const { unmount } = renderHook((p: Props) => useWizardFunnel(p), { initialProps: props({ step: 2 }) });
    unmount();
    expect(rows("abandoned")).toEqual([
      expect.objectContaining({ last_step: "step_2_vibes", locale: "en" }),
    ]);
  });
});
