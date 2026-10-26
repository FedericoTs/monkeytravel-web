import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useKeptPlan } from "./useKeptPlan";
import type { KeptPlan } from "@/lib/plans/kept-plan";

/**
 * A signed-out planner's plan is kept once, its changes are sent after they
 * settle, a plan opened from its link is not kept again, and a change still
 * waiting when the planner goes is sent on the way out.
 */

const plan = (endDate = "2027-03-17"): KeptPlan => ({
  destination: "Lisbon, Portugal",
  startDate: "2027-03-15",
  endDate,
  itinerary: {
    destination: { name: "Lisbon", country: "Portugal", description: "", best_for: [], weather_note: "" },
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

function harness(planId: string, first: KeptPlan, enabled = true) {
  return renderHook((p: { plan: KeptPlan; enabled: boolean }) => useKeptPlan({ enabled: p.enabled, planId, plan: p.plan }), {
    initialProps: { plan: first, enabled },
  });
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
