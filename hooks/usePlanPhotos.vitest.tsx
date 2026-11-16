/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { GeneratedItinerary } from "@/types";
import { usePlanPhotos } from "./usePlanPhotos";

/**
 * A new plan's places are looked up on Wikimedia while it is on screen: the
 * planner asks for the photos found, twice, and swaps them in for the stock
 * images, never over a real photo, and once per plan.
 */

const WIKI = "/api/images/wikimedia/abc-500.jpg?a=X&l=CC0&f=Y.jpg";
const GOOGLE = "/api/places/photo?name=places%2Fx%2Fphotos%2Fp&w=600&h=400";
const STOCK = "https://images.pexels.com/photos/1/a.jpeg";

const planWith = (activities: Array<{ id: string; name: string; image_url?: string }>) =>
  ({ destination: { name: "Prague", country: "Czechia" }, days: [{ day_number: 1, activities }] }) as unknown as GeneratedItinerary;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ photos: [WIKI, null] }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Renders the hook over a plan held like the planner holds it. */
function show(initial: GeneratedItinerary | null, destination = "Prague, Czechia") {
  let plan = initial;
  const onPlan = vi.fn((update: (prev: GeneratedItinerary | null) => GeneratedItinerary | null) => {
    plan = update(plan);
  });
  const hook = renderHook((props: { plan: GeneratedItinerary | null }) => usePlanPhotos({ plan: props.plan, destination, onPlan }), {
    initialProps: { plan },
  });
  return { onPlan, current: () => plan, ...hook };
}

const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("usePlanPhotos", () => {
  it("asks for the stand-ins' photos after the plan is shown, and swaps the ones found in", async () => {
    const { current } = show(planWith([
      { id: "a1", name: "Charles Bridge", image_url: STOCK },
      { id: "a2", name: "Lokál", image_url: STOCK },
    ]));
    await flush(4_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await flush(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/images/landmarks");
    expect(JSON.parse(init.body as string)).toEqual({ destination: "Prague, Czechia", names: ["Charles Bridge", "Lokál"] });
    expect(current()!.days[0].activities.map((a) => a.image_url)).toEqual([WIKI, STOCK]);
  });

  it("asks a second time for what is still a stand-in, then stops", async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ photos: [null, null] }) }));
    show(planWith([
      { id: "a1", name: "Charles Bridge", image_url: STOCK },
      { id: "a2", name: "Lokál" },
    ]));
    await flush(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flush(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks nothing for a plan whose places all have real photos, or without a destination", async () => {
    show(planWith([{ id: "a1", name: "Charles Bridge", image_url: GOOGLE }]));
    show(planWith([{ id: "a1", name: "Charles Bridge", image_url: STOCK }]), " ");
    show(null);
    await flush(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives a stop showing no photo its photo only below the screen, so nothing being read moves", async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ photos: [WIKI, WIKI, WIKI, WIKI, WIKI] }) }));
    const place = (id: string, top: number) => {
      const element = document.createElement("div");
      element.id = `activity-${id}`;
      element.getBoundingClientRect = () => ({ top, bottom: top + 120 }) as DOMRect;
      document.body.appendChild(element);
    };
    place("a1", 200);
    place("a2", -500);
    place("a3", window.innerHeight + 300);
    place("a4", 300);
    const { current } = show(planWith([
      { id: "a1", name: "Charles Bridge" },
      { id: "a2", name: "Old Town Square" },
      { id: "a3", name: "Vyšehrad" },
      { id: "a4", name: "Lokál", image_url: STOCK },
      // Not on the page (a closed day): adding its photo moves nothing.
      { id: "a5", name: "Petřín" },
    ]));
    await flush(5_000);
    // On screen and above stay as they are; below gets its photo; a stand-in on screen is swapped where it is.
    expect(current()!.days[0].activities.map((a) => a.image_url)).toEqual([undefined, undefined, WIKI, WIKI, WIKI]);
    document.body.innerHTML = "";
  });

  it("does not start again when only the photos change, and stops for a plan that is gone", async () => {
    const first = planWith([{ id: "a1", name: "Charles Bridge", image_url: STOCK }]);
    const { rerender, unmount } = show(first);
    await flush(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The same plan with its new photo: same activities, so no new round.
    rerender({ plan: planWith([{ id: "a1", name: "Charles Bridge", image_url: WIKI }]) });
    await flush(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });
});
