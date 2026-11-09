import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type SetStateAction } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import type { ItineraryDay } from "@/types";

const addToast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

import { useDayRegeneration } from "./useDayRegeneration";

/**
 * Regenerating one day: asked in the save queue, the new day comes in with an
 * undo step and a remount; a refusal or failure is said and changes nothing.
 */

const PLAN = [
  { day_number: 1, activities: [{ id: "a1", name: "Castle" }] },
  { day_number: 2, activities: [{ id: "b1", name: "Museum" }] },
] as unknown as ItineraryDay[];
const NEW_DAY = { day_number: 2, activities: [{ name: "LX Factory" }] };

function setup(answer: () => Promise<Response>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
    await gate;
    return answer();
  });
  vi.stubGlobal("fetch", fetchMock);
  const order: string[] = [];
  const props = {
    tripId: "t1",
    pushUndo: vi.fn((_action: string) => void order.push("undo")),
    undo: vi.fn(),
    runItineraryWrite: vi.fn(async (task: () => Promise<unknown>, _options?: { keepsLocalEdits?: boolean }) => task()),
    adoptDayWrite: vi.fn(
      async (_splice: (it: ItineraryDay[]) => ItineraryDay[], _from: number | null, _to: number | null) =>
        void order.push("adopt")
    ),
    setRenderEpoch: vi.fn((_update: SetStateAction<number>) => {}),
    setSaveError: vi.fn((_message: string | null) => {}),
  };
  const view = renderHook(() =>
    useDayRegeneration({ ...props, runItineraryWrite: props.runItineraryWrite as Parameters<typeof useDayRegeneration>[0]["runItineraryWrite"] })
  );
  const regenerate = async (instructions?: string) => {
    let done!: Promise<void>;
    await act(async () => {
      done = view.result.current.handleDayRegenerate(2, instructions);
    });
    const inFlight = view.result.current.regeneratingDayNumber;
    await act(async () => {
      release();
      await done;
    });
    return inFlight;
  };
  return { props, view, regenerate, fetchMock, order };
}

const json = (status: number, body: unknown) => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

beforeEach(() => {
  addToast.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDayRegeneration", () => {
  it("asks in the save queue, then takes the new day with an undo step, remounts it and says so", async () => {
    const { props, view, regenerate, fetchMock, order } = setup(json(200, { day: NEW_DAY, fromVersion: 7, itineraryVersion: 8 }));
    expect(await regenerate()).toBe(2);
    expect(view.result.current.regeneratingDayNumber).toBeNull();
    expect(props.runItineraryWrite.mock.calls[0][1]).toEqual({ keepsLocalEdits: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ tripId: "t1", dayNumber: 2 });
    expect(props.pushUndo).toHaveBeenCalledWith("Regenerate Day 2");
    expect(order).toEqual(["undo", "adopt"]);
    const [splice, from, to] = props.adoptDayWrite.mock.calls[0];
    expect(splice(PLAN).map((d) => d.activities.map((a) => a.name))).toEqual([["Castle"], ["LX Factory"]]);
    expect(splice(PLAN)[1].activities[0].id).toBeTruthy();
    expect([from, to]).toEqual([7, 8]);
    expect((props.setRenderEpoch.mock.calls[0][0] as (v: number) => number)(5)).toBe(6);
    expect(addToast).toHaveBeenCalledWith('detail.regenerateDay.done {"number":2}', "success", 6000, { label: "detail.undo", onClick: expect.any(Function) });
    addToast.mock.calls.at(-1)![3].onClick();
    expect(props.undo).toHaveBeenCalledTimes(1);
  });

  it("sends the traveller's words trimmed and cut at 500 characters, and none when blank", async () => {
    for (const [instructions, sent] of [
      ["  boarding the cruise  ", "boarding the cruise"],
      ["x".repeat(600), "x".repeat(500)],
      ["   ", undefined],
    ] as const) {
      const { regenerate, fetchMock } = setup(json(200, { day: NEW_DAY }));
      await regenerate(instructions);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).instructions).toBe(sent);
      cleanup();
    }
  });

  it("reads a new day wrapped in data", async () => {
    const { props, regenerate } = setup(json(200, { data: { day: NEW_DAY, fromVersion: "7", itineraryVersion: null } }));
    await regenerate();
    expect(props.adoptDayWrite).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('detail.regenerateDay.done {"number":2}', "success", 6000, { label: "detail.undo", onClick: expect.any(Function) });
  });

  it.each([
    ["the monthly limit", json(429, { error: { message: "limit" } }), "detail.regenerateDay.limit"],
    ["a busy trip", json(409, { error: "busy" }), "detail.regenerateDay.busy"],
    ["the model out of service", json(503, { error: "unavailable", code: "MODEL_OUTAGE" }), "errors.modelOutage"],
    ["an error without JSON", json(500, "<html>"), 'detail.regenerateDay.failed {"number":2}'],
    ["no day in the answer", json(200, { data: {} }), 'detail.regenerateDay.failed {"number":2}'],
    ["a request that did not get through", async () => Promise.reject(new TypeError("Failed to fetch")), 'detail.regenerateDay.failed {"number":2}'],
  ])("on %s, says so and changes nothing", async (_, answer, message) => {
    const { props, view, regenerate } = setup(answer as () => Promise<Response>);
    await regenerate();
    expect(props.setSaveError).toHaveBeenCalledWith(message);
    expect(addToast).toHaveBeenCalledWith(message, "error");
    expect(props.pushUndo).not.toHaveBeenCalled();
    expect(props.adoptDayWrite).not.toHaveBeenCalled();
    expect(props.setRenderEpoch).not.toHaveBeenCalled();
    expect(view.result.current.regeneratingDayNumber).toBeNull();
  });
});
