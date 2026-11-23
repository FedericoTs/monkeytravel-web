// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Route = Array<{ city: string; nights: number }>;
const asked = vi.hoisted(() => ({
  calls: [] as Array<{ place: string; days: number; startDate: string; locale: string; signal: AbortSignal }>,
  answer: [] as Array<{ city: string; nights: number }>,
  hold: null as Promise<Array<{ city: string; nights: number }>> | null,
}));
vi.mock("@/lib/wizard/route-offer", () => ({
  ROUTE_TIMEOUT_MS: 10_000,
  fetchRouteOffer: async (ask: { place: string; days: number; startDate: string; locale: string }, signal: AbortSignal) => {
    asked.calls.push({ ...ask, signal });
    return asked.hold ?? asked.answer;
  },
}));

import { useRouteOffer } from "./useRouteOffer";

type Ask = { place: string; days: number } | null;
const offer = (ask: Ask, startDate = "2027-01-10", locale = "en") =>
  renderHook((p: { ask: Ask; startDate: string; locale: string }) => useRouteOffer(p.ask, p.startDate, p.locale), {
    initialProps: { ask, startDate, locale },
  });
const props = (ask: Ask, startDate = "2027-01-10", locale = "en") => ({ ask, startDate, locale });

const THAILAND: Route = [
  { city: "Bangkok", nights: 3 },
  { city: "Chiang Mai", nights: 4 },
  { city: "Phuket", nights: 7 },
];
const VIETNAM: Route = [
  { city: "Hanoi", nights: 4 },
  { city: "Hoi An", nights: 5 },
  { city: "Ho Chi Minh City", nights: 5 },
];

beforeEach(() => {
  vi.useFakeTimers();
  asked.calls = [];
  asked.answer = THAILAND;
  asked.hold = null;
});
afterEach(() => vi.useRealTimers());

const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
};

describe("useRouteOffer", () => {
  it("asks once the place and dates have settled, and offers the route", async () => {
    const hook = offer({ place: "Thailand", days: 14 });
    expect(hook.result.current).toBeNull();
    expect(asked.calls).toEqual([]);
    await settle();
    expect(asked.calls.map(({ signal: _signal, ...c }) => c)).toEqual([{ place: "Thailand", days: 14, startDate: "2027-01-10", locale: "en" }]);
    expect(hook.result.current).toEqual(THAILAND);
  });

  it("asks only for the place left in the field, not each one typed on the way", async () => {
    const hook = offer({ place: "Thai", days: 14 });
    hook.rerender(props({ place: "Thailan", days: 14 }));
    hook.rerender(props({ place: "Thailand", days: 14 }));
    await settle();
    expect(asked.calls.map((c) => c.place)).toEqual(["Thailand"]);
  });

  it("waits out short pauses while a place is typed", async () => {
    const hook = offer({ place: "Viet", days: 14 });
    for (const place of ["Vietn", "Vietna", "Vietnam"]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      hook.rerender(props({ place, days: 14 }));
    }
    await settle();
    expect(asked.calls.map((c) => c.place)).toEqual(["Vietnam"]);
  });

  it("offers nothing for one base, or while there's nothing to ask", async () => {
    asked.answer = [{ city: "Tokyo", nights: 10 }];
    const hook = offer({ place: "Tokyo", days: 10 });
    await settle();
    expect(hook.result.current).toBeNull();
    hook.rerender(props(null));
    await settle();
    expect(asked.calls).toHaveLength(1);
    expect(hook.result.current).toBeNull();
  });

  it("keeps an answer for the visit: back to a place and length asked before, no new question", async () => {
    const hook = offer({ place: "Thailand", days: 14 });
    await settle();
    hook.rerender(props({ place: "Thailand", days: 10 }));
    await settle();
    hook.rerender(props({ place: "Thailand", days: 14 }));
    await settle();
    expect(asked.calls.map((c) => c.days)).toEqual([14, 10]);
    expect(hook.result.current).toEqual(THAILAND);
  });

  it("asks again in another month or language: the season changes the route, the names follow the page", async () => {
    const hook = offer({ place: "Thailand", days: 14 });
    await settle();
    hook.rerender(props({ place: "Thailand", days: 14 }, "2027-07-10"));
    await settle();
    hook.rerender(props({ place: "Thailand", days: 14 }, "2027-07-10", "es"));
    await settle();
    expect(asked.calls.map((c) => `${c.startDate} ${c.locale}`)).toEqual(["2027-01-10 en", "2027-07-10 en", "2027-07-10 es"]);
  });

  it("drops an answer that comes back after the place changed", async () => {
    let release: (route: Route) => void = () => {};
    asked.hold = new Promise<Route>((resolve) => {
      release = resolve;
    });
    const hook = offer({ place: "Thailand", days: 14 });
    await settle();
    const first = asked.calls[0];
    hook.rerender(props({ place: "Vietnam", days: 14 }));
    expect(first.signal.aborted).toBe(true);
    asked.hold = null;
    asked.answer = VIETNAM;
    await act(async () => release(THAILAND));
    await settle();
    expect(hook.result.current).toEqual(VIETNAM);
    // The late answer wasn't kept: back to Thailand, it's asked again.
    hook.rerender(props({ place: "Thailand", days: 14 }));
    await settle();
    expect(asked.calls.map((c) => c.place)).toEqual(["Thailand", "Vietnam", "Thailand"]);
  });
});
