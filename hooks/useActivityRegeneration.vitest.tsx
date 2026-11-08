import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import type { ItineraryDay } from "@/types";

const addToast = vi.fn();
const tracked = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/analytics", () => ({ trackActivityRegenerated: (p: unknown) => tracked(p) }));

import { useActivityRegeneration } from "./useActivityRegeneration";

/**
 * Regenerating one activity: the suggestion takes its place with an undo
 * step; a refusal or failure is said and changes nothing.
 */

const PLAN = [
  { day_number: 1, activities: [{ id: "a1", name: "Castle" }, { id: "a2", name: "Lunch" }] },
] as unknown as ItineraryDay[];

function setup(answer: () => Promise<Response>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
    await gate;
    return answer();
  });
  vi.stubGlobal("fetch", fetchMock);
  const props = {
    tripId: "t1",
    destination: "Lisbon",
    itinerary: PLAN,
    setItinerary: vi.fn(),
    pushUndo: vi.fn(),
    undo: vi.fn(),
    setSaveError: vi.fn(),
  };
  const view = renderHook(() => useActivityRegeneration(props));
  const regenerate = async () => {
    let done!: Promise<void>;
    await act(async () => {
      done = view.result.current.handleActivityRegenerate("a2", 0);
    });
    const inFlight = view.result.current.regeneratingActivityId;
    await act(async () => {
      release();
      await done;
    });
    return inFlight;
  };
  return { props, view, regenerate, fetchMock };
}

const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  addToast.mockClear();
  tracked.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useActivityRegeneration", () => {
  it("puts the suggestion in the activity's place, keeping its id, with an undo step", async () => {
    const { props, view, regenerate, fetchMock } = setup(json(200, { activity: { id: "x", name: "Tram 28", type: "transport" } }));
    expect(await regenerate()).toBe("a2");
    expect(view.result.current.regeneratingActivityId).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      tripId: "t1",
      activityId: "a2",
      dayIndex: 0,
      destination: "Lisbon",
      itinerary: PLAN,
    });
    expect(props.pushUndo).toHaveBeenCalledWith("Regenerate activity");
    const next = props.setItinerary.mock.calls[0][0](PLAN) as ItineraryDay[];
    expect(next[0].activities.map((a) => [a.id, a.name])).toEqual([
      ["a1", "Castle"],
      ["a2", "Tram 28"],
    ]);
    expect(tracked).toHaveBeenCalledWith({ tripId: "t1", activityType: "transport" });
    expect(props.setSaveError).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith("editActivity.regenerated", "success", 6000, {
      label: "detail.undo",
      onClick: expect.any(Function),
    });
    addToast.mock.calls.at(-1)[3].onClick();
    expect(props.undo).toHaveBeenCalledTimes(1);
  });

  it("counts a suggestion without a type as unknown", async () => {
    const { regenerate } = setup(json(200, { activity: { name: "Walk" } }));
    await regenerate();
    expect(tracked).toHaveBeenCalledWith({ tripId: "t1", activityType: "unknown" });
  });

  it("names the monthly limit when that stopped it, and changes nothing", async () => {
    const { props, regenerate } = setup(json(429, { error: "limit" }));
    await regenerate();
    expect(props.setSaveError).toHaveBeenCalledWith("detail.activityRegenerateLimit");
    expect(addToast).toHaveBeenCalledWith("detail.activityRegenerateLimit", "error");
    expect(props.pushUndo).not.toHaveBeenCalled();
    expect(props.setItinerary).not.toHaveBeenCalled();
  });

  it("says the AI is down when the model is out of service, and changes nothing", async () => {
    const { props, regenerate } = setup(json(503, { error: "unavailable", code: "MODEL_OUTAGE" }));
    await regenerate();
    expect(props.setSaveError).toHaveBeenCalledWith("errors.modelOutage");
    expect(addToast).toHaveBeenCalledWith("errors.modelOutage", "error");
    expect(props.pushUndo).not.toHaveBeenCalled();
    expect(props.setItinerary).not.toHaveBeenCalled();
  });

  it.each([
    ["no suggestion came back", json(200, {})],
    ["the server failed", json(500, { error: "boom" })],
    ["the server failed, whatever it sent", json(500, { activity: { name: "Walk" } })],
    ["the request did not get through", async () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("says it failed when %s, and changes nothing", async (_, answer) => {
    const { props, view, regenerate } = setup(answer as () => Promise<Response>);
    await regenerate();
    expect(props.setSaveError).toHaveBeenCalledWith("detail.activityRegenerateFailed");
    expect(addToast).toHaveBeenCalledWith("detail.activityRegenerateFailed", "error");
    expect(props.pushUndo).not.toHaveBeenCalled();
    expect(props.setItinerary).not.toHaveBeenCalled();
    expect(view.result.current.regeneratingActivityId).toBeNull();
  });
});
