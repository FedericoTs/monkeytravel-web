import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useKeptPlan } from "./useKeptPlan";
import type { KeptPlan } from "@/lib/plans/kept-plan";
import { readKeptPlans } from "@/lib/plans/kept-plans-client";

/**
 * A signed-out planner's plan is kept once, its changes are sent after they
 * settle, a plan opened from its link is not kept again, and a change still
 * waiting when the planner goes is sent on the way out.
 */

// `version` stands for the plan's content: the same trip made again, or changed, reads differently.
const plan = (endDate = "2027-03-17", version = ""): KeptPlan => ({
  destination: "Lisbon, Portugal",
  startDate: "2027-03-15",
  endDate,
  itinerary: {
    destination: { name: "Lisbon", country: "Portugal", description: version, best_for: [], weather_note: "" },
    days: [],
    trip_summary: { total_estimated_cost: 0, currency: "EUR", highlights: [], packing_suggestions: [] },
  },
});

type Call = { url: string; method: string; key: string | null; keepalive: boolean; body: { plan: KeptPlan } | null };
let calls: Call[] = [];
let made = 0;

beforeEach(() => {
  calls = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      calls.push({
        url,
        method: init.method ?? "GET",
        key: headers.get("x-plan-key"),
        keepalive: init.keepalive === true,
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      if (url === "/api/plans") {
        made += 1;
        const token = `TOKEN${String(made).padStart(17, "x")}`;
        return new Response(JSON.stringify({ token, key: `key-${made}`, expiresAt: "2099-01-01T00:00:00.000Z" }), { status: 201 });
      }
      return new Response(JSON.stringify({ expiresAt: "2099-02-01T00:00:00.000Z" }), { status: 200 });
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** `edited`: whether the page says the planner changed the plan (the assistant's edits). */
function harness(planId: string, first: KeptPlan, enabled = true, edited: () => boolean = () => true) {
  return renderHook(
    (p: { plan: KeptPlan; enabled: boolean }) => useKeptPlan({ enabled: p.enabled, planId, plan: p.plan, changedByPlanner: edited }),
    { initialProps: { plan: first, enabled } }
  );
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe("useKeptPlan", () => {
  it("keeps a plan the first time it is seen, once", async () => {
    const first = plan();
    const hook = harness("keep-once", first);
    await settle();
    expect(calls.map((c) => [c.method, c.url])).toEqual([["POST", "/api/plans"]]);
    expect(hook.result.current.kept?.token).toMatch(/^TOKEN/);
    hook.rerender({ plan: first, enabled: true });
    await settle();
    expect(calls).toHaveLength(1);
  });

  it("sends a change to the same plan once it settles, with the key", async () => {
    const hook = harness("change", plan());
    await settle();
    const token = hook.result.current.kept!.token;
    hook.rerender({ plan: plan("2027-03-18"), enabled: true });
    await settle();
    expect(calls).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(2500));
    const put = calls[1];
    expect([put.method, put.url]).toEqual(["PUT", `/api/plans/${token}`]);
    expect(put.key).toMatch(/^key-/);
    expect(put.body?.plan.endDate).toBe("2027-03-18");
  });

  it("does not keep again a plan opened from its link", async () => {
    const opened = plan();
    const token = "OPENEDxxxxxxxxxxxxxxxx";
    const view = harness("opened", opened, false);
    act(() => view.result.current.adoptOpened(token, opened, "2099-01-01T00:00:00.000Z"));
    view.rerender({ plan: opened, enabled: true });
    await settle();
    expect(calls).toHaveLength(0);
    expect(view.result.current.kept?.token).toBe(token);
  });

  it("keeps a changed copy of a plan this browser has no key for", async () => {
    const opened = plan();
    const token = "FOREIGNxxxxxxxxxxxxxxx";
    const view = harness("foreign", opened, false);
    act(() => view.result.current.adoptOpened(token, opened, "2099-01-01T00:00:00.000Z"));
    view.rerender({ plan: opened, enabled: true });
    await settle();
    expect(calls).toHaveLength(0);
    view.rerender({ plan: plan("2027-03-19"), enabled: true });
    await settle();
    expect(calls.map((c) => [c.method, c.url])).toEqual([["POST", "/api/plans"]]);
    expect(view.result.current.kept?.token).not.toBe(token);
  });

  it("keeps nothing while it is off", async () => {
    const hook = harness("off", plan(), false);
    await settle();
    expect(calls).toHaveLength(0);
    expect(hook.result.current.kept).toBeNull();
  });

  it("sends a waiting change on the way out", async () => {
    const hook = harness("leave", plan());
    await settle();
    hook.rerender({ plan: plan("2027-03-20"), enabled: true });
    await settle();
    hook.unmount();
    const last = calls[calls.length - 1];
    expect(last.method).toBe("PUT");
    expect(last.keepalive).toBe(true);
    expect(last.body?.plan.endDate).toBe("2027-03-20");
  });
});

describe("a plan the planner changed", () => {
  const sendSettled = () => act(() => vi.advanceTimersByTimeAsync(2500));

  it("is marked changed once its change is sent", async () => {
    const hook = harness("mark", plan("2027-03-17", "as made"));
    await settle();
    hook.rerender({ plan: plan("2027-03-17", "a stop swapped"), enabled: true });
    await sendSettled();
    expect(readKeptPlans()[0]).toMatchObject({ token: hook.result.current.kept!.token, changed: true });
  });

  it("is marked changed when its change goes out with the page", async () => {
    const hook = harness("leave-changed", plan("2027-03-17", "as made"));
    await settle();
    hook.rerender({ plan: plan("2027-03-17", "a stop swapped"), enabled: true });
    await settle();
    hook.unmount();
    expect(readKeptPlans()[0].changed).toBe(true);
  });

  it("is not replaced by a new plan for the same trip: the new one is kept beside it", async () => {
    const first = harness("edited", plan("2027-03-17", "as made"));
    await settle();
    const edited = first.result.current.kept!.token;
    first.rerender({ plan: plan("2027-03-17", "a stop swapped"), enabled: true });
    await sendSettled();
    calls = [];
    const again = harness("made-again", plan("2027-03-17", "made again"));
    await settle();
    await sendSettled();
    expect(calls.map((c) => [c.method, c.url])).toEqual([["POST", "/api/plans"]]);
    expect(again.result.current.kept?.token).not.toBe(edited);
    expect(readKeptPlans().map((e) => [e.token === edited, e.changed === true])).toEqual([
      [false, false],
      [true, true],
    ]);
  });

  it("is linked again, not kept twice, when the same version comes back in another tab", async () => {
    const first = harness("tab-one", plan("2027-03-17", "as made"));
    await settle();
    const token = first.result.current.kept!.token;
    first.rerender({ plan: plan("2027-03-17", "a stop swapped"), enabled: true });
    await sendSettled();
    calls = [];
    const other = harness("tab-two", plan("2027-03-17", "a stop swapped"));
    await settle();
    await sendSettled();
    expect(calls).toHaveLength(0);
    expect(other.result.current.kept?.token).toBe(token);
  });
});

describe("a plan opened in another tab", () => {
  it("is linked without a send, and a change made there marks it changed", async () => {
    const first = harness("plain-one", plan("2027-03-17", "as made"));
    await settle();
    const token = first.result.current.kept!.token;
    calls = [];
    const other = harness("plain-two", plan("2027-03-17", "as made"));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(calls).toHaveLength(0);
    other.rerender({ plan: plan("2027-03-17", "a stop swapped"), enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(calls.map((c) => [c.method, c.url])).toEqual([["PUT", `/api/plans/${token}`]]);
    expect(readKeptPlans()[0]).toMatchObject({ token, changed: true });
  });
});

describe("a plan that changed by itself", () => {
  const quiet = () => false;

  it("is not marked by photos arriving, and is brought up to date when the trip is made again", async () => {
    const first = harness("photos", plan("2027-03-17", "as made"), true, quiet);
    await settle();
    const token = first.result.current.kept!.token;
    first.rerender({ plan: plan("2027-03-17", "as made, with photos"), enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(readKeptPlans()[0].changed).toBeUndefined();
    calls = [];
    const again = harness("photos-again", plan("2027-03-17", "made again"), true, quiet);
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(calls.map((c) => [c.method, c.url])).toEqual([["PUT", `/api/plans/${token}`]]);
    expect(again.result.current.kept?.token).toBe(token);
  });

  it("is not marked when such a change goes out with the page", async () => {
    const hook = harness("photos-leave", plan("2027-03-17", "as made"), true, quiet);
    await settle();
    hook.rerender({ plan: plan("2027-03-17", "as made, with photos"), enabled: true });
    await settle();
    hook.unmount();
    expect(readKeptPlans()[0].changed).toBeUndefined();
  });

  it("keeps the planner's mark through later changes the planner didn't make", async () => {
    let edited = true;
    const hook = harness("edit-then-photos", plan("2027-03-17", "as made"), true, () => edited);
    await settle();
    hook.rerender({ plan: plan("2027-03-17", "a stop swapped"), enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    // A reload: this page no longer knows of the edits.
    edited = false;
    hook.rerender({ plan: plan("2027-03-17", "a stop swapped, with photos"), enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(readKeptPlans()[0].changed).toBe(true);
  });
});

describe("a plan made again for the same trip", () => {
  it("is not marked when it replaces a plan and goes out with the page", async () => {
    harness("replace-leave-one", plan("2027-03-17", "as made"));
    await settle();
    const again = harness("replace-leave-two", plan("2027-03-17", "made again"));
    await settle();
    again.unmount();
    expect(readKeptPlans()[0].changed).toBeUndefined();
  });

  it("brings an unchanged kept plan up to date instead of keeping another, and marks it once it is changed", async () => {
    const first = harness("unchanged", plan("2027-03-17", "as made"));
    await settle();
    const token = first.result.current.kept!.token;
    calls = [];
    const again = harness("unchanged-again", plan("2027-03-17", "made again"));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(calls.map((c) => [c.method, c.url])).toEqual([["PUT", `/api/plans/${token}`]]);
    expect(again.result.current.kept?.token).toBe(token);
    // Replacing a plan is not changing it ...
    expect(readKeptPlans()[0].changed).toBeUndefined();
    // ... and a change to the plan that replaced it is.
    again.rerender({ plan: plan("2027-03-17", "made again, then a stop swapped"), enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(readKeptPlans()[0]).toMatchObject({ token, changed: true });
  });
});
