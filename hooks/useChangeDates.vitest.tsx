/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { GeneratedItinerary } from "@/types";
import { useChangeDates } from "./useChangeDates";

/**
 * Changing a generated plan's dates: the plan moves with them, a shorter trip
 * keeps its first days, and a longer one asks the assistant for the new days,
 * which land only on the plan they were asked for.
 */

const capture = vi.hoisted(() => vi.fn());
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
  useLocale: () => "it",
}));
vi.mock("@/lib/posthog", () => ({ usePostHog: () => ({ capture }) }));

const day = (n: number) => ({
  day_number: n,
  date: `2027-05-${String(9 + n).padStart(2, "0")}`,
  activities: [{ id: `a${n}`, name: `Place ${n}`, estimated_cost: { amount: 10, currency: "EUR" } }],
});
const threeDays = () =>
  ({ destination: { name: "Paris", country: "France" }, days: [day(1), day(2), day(3)], trip_summary: { total_estimated_cost: 900 } }) as unknown as GeneratedItinerary;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const extra = (n: number) => ({ day_number: n, activities: [{ name: `Extra ${n}` }] });

function show(initial: GeneratedItinerary | null = threeDays()) {
  const onDates = vi.fn();
  const hook = renderHook(() => {
    const [plan, setPlan] = useState(initial);
    return { plan, ...useChangeDates({ plan, onPlan: setPlan, onDates }) };
  });
  return { onDates, now: () => hook.result.current };
}
const applyEdits = vi.fn((): string | undefined => "edit-1");
const change = (now: ReturnType<typeof show>["now"], start: string, end: string) => now().changeDates(start, end, { maxDays: 14, applyEdits });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  capture.mockClear();
  applyEdits.mockClear();
});

describe("new dates of the same length", () => {
  it("move every day, keep the total, and ask no one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { now, onDates } = show();
    act(() => now().setShowChangeDates(true));
    await act(() => change(now, "2027-06-01", "2027-06-03"));
    expect(now().plan!.days.map((d) => d.date)).toEqual(["2027-06-01", "2027-06-02", "2027-06-03"]);
    expect(now().plan!.trip_summary?.total_estimated_cost).toBe(900);
    expect(onDates).toHaveBeenCalledWith("2027-06-01", "2027-06-03");
    expect(now().showChangeDates).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith("wizard_dates_changed", { from_days: 3, to_days: 3, kind: "same" });
  });
});

describe("a shorter trip", () => {
  it("keeps its first days, and the end date follows", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { now, onDates } = show();
    await act(() => change(now, "2027-06-01", "2027-06-02"));
    expect(now().plan!.days.map((d) => d.day_number)).toEqual([1, 2]);
    expect(onDates).toHaveBeenCalledWith("2027-06-01", "2027-06-02");
    expect(capture).toHaveBeenCalledWith("wizard_dates_changed", { from_days: 3, to_days: 2, kind: "shorter" });
  });
});

describe("dates that can't be", () => {
  it.each([
    ["an end before the start", "2027-06-05", "2027-06-01"],
    ["more days than a trip can have", "2027-06-01", "2027-07-30"],
  ])("%s change nothing, and leave the dialog open", async (_name, start, end) => {
    vi.stubGlobal("fetch", vi.fn());
    const { now, onDates } = show();
    act(() => now().setShowChangeDates(true));
    await act(() => change(now, start, end));
    expect(now().plan!.days[0].date).toBe("2027-05-10");
    expect(onDates).not.toHaveBeenCalled();
    expect(now().showChangeDates).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });

  it("with no plan on screen, nothing happens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { now, onDates } = show(null);
    await act(() => change(now, "2027-06-01", "2027-06-03"));
    expect(onDates).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a longer trip", () => {
  it("moves the days it has, then asks for only the new ones, and applies them", async () => {
    const fetchMock = vi.fn(async () => json({ data: { edits: [extra(4), extra(5)], tripLength: 5 } }));
    vi.stubGlobal("fetch", fetchMock);
    const { now, onDates } = show();
    await act(() => change(now, "2027-06-01", "2027-06-05"));
    expect(now().plan!.days.map((d) => d.date)).toEqual(["2027-06-01", "2027-06-02", "2027-06-03"]);
    // The end date is where the plan reaches until the new days land.
    expect(onDates).toHaveBeenCalledWith("2027-06-01", "2027-06-03");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai/assistant-anon");
    const body = JSON.parse(String(init.body));
    expect(body.message).toContain("Days 4 to 5");
    expect(body.days).toHaveLength(3);
    expect(body.days[0].date).toBe("2027-06-01");
    expect(body.tripTitle).toBeTruthy();
    expect(body.locale).toBe("it");
    expect(applyEdits).toHaveBeenCalledWith([extra(4), extra(5)], 5);
    expect(now().datesNotice).toBeNull();
    expect(now().planningExtraDays).toBe(false);
  });

  it("says it is planning while the answer travels", async () => {
    let land: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (land = resolve))));
    const { now } = show();
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = change(now, "2027-06-01", "2027-06-05");
    });
    expect(now().planningExtraDays).toBe(true);
    await act(async () => {
      land(json({ data: { edits: [extra(4), extra(5)], tripLength: 5 } }));
      await done;
    });
    expect(now().planningExtraDays).toBe(false);
  });

  it("notes how far it got when only some days came back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: { edits: [extra(4)], tripLength: 4 } })));
    const { now } = show();
    await act(() => change(now, "2027-06-01", "2027-06-05"));
    expect(applyEdits).toHaveBeenCalledWith([extra(4)], 4);
    expect(now().datesNotice).toMatch(/partlyPlanned .*"count":4/);
  });

  it.each([
    ["the assistant refuses", () => json({}, 500)],
    ["the assistant refuses, whatever its answer says", () => json({ data: { edits: [extra(4), extra(5)], tripLength: 5 } }, 500)],
    ["its answer has no new days", () => json({ data: { edits: [], tripLength: 3 } })],
    ["its answer promises days and sends none", () => json({ data: { edits: [], tripLength: 5 } })],
    ["its answer isn't JSON", () => new Response("<html>", { status: 200 })],
  ])("notes that the days couldn't be planned when %s", async (_name, answer) => {
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
    const { now } = show();
    await act(() => change(now, "2027-06-01", "2027-06-05"));
    expect(applyEdits).not.toHaveBeenCalled();
    expect(now().datesNotice).toMatch(/extraFailed .*"count":3/);
    expect(now().planningExtraDays).toBe(false);
  });

  it("notes the same when the connection drops", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Load failed"))));
    const { now } = show();
    await act(() => change(now, "2027-06-01", "2027-06-05"));
    expect(now().datesNotice).toMatch(/extraFailed/);
    expect(now().planningExtraDays).toBe(false);
  });
});

describe("a plan that replaces this one", () => {
  // An answer that never comes, until the request is cancelled.
  function heldAnswer() {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          })
      )
    );
  }

  it("drops the note left by the old one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));
    const { now } = show();
    await act(() => change(now, "2027-06-01", "2027-06-05"));
    expect(now().datesNotice).not.toBeNull();
    act(() => now().forgetDatesChange());
    expect(now().datesNotice).toBeNull();
  });

  it("cancels the days still being planned: nothing lands, and no note", async () => {
    heldAnswer();
    const { now } = show();
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = change(now, "2027-06-01", "2027-06-05");
    });
    expect(now().planningExtraDays).toBe(true);
    await act(async () => {
      now().forgetDatesChange();
      await done;
    });
    expect(applyEdits).not.toHaveBeenCalled();
    expect(now().datesNotice).toBeNull();
    expect(now().planningExtraDays).toBe(false);
  });

  it("drops an answer that had already arrived but wasn't read", async () => {
    let read: (v: unknown) => void = () => {};
    const arrived = { ok: true, json: () => new Promise<unknown>((resolve) => (read = resolve)) };
    vi.stubGlobal("fetch", vi.fn(async () => arrived));
    const { now } = show();
    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = change(now, "2027-06-01", "2027-06-05");
      await Promise.resolve();
    });
    await act(async () => {
      now().forgetDatesChange();
      read({ data: { edits: [extra(4), extra(5)], tripLength: 5 } });
      await done;
    });
    expect(applyEdits).not.toHaveBeenCalled();
    expect(now().datesNotice).toBeNull();
  });

  it("new dates also cancel the days still being planned for the old ones", async () => {
    heldAnswer();
    const { now } = show();
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = change(now, "2027-06-01", "2027-06-05");
    });
    await act(async () => {
      await change(now, "2027-06-01", "2027-06-02");
      await first;
    });
    expect(applyEdits).not.toHaveBeenCalled();
    expect(now().planningExtraDays).toBe(false);
  });

  it("the cancelled request doesn't end the wait for the one that replaced it", async () => {
    heldAnswer();
    const { now } = show();
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = change(now, "2027-06-01", "2027-06-05");
    });
    await act(async () => {
      void change(now, "2027-06-01", "2027-06-06");
      await first;
    });
    expect(now().planningExtraDays).toBe(true);
    act(() => now().forgetDatesChange());
  });
});
