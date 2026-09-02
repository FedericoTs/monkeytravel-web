/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFunnelWindow,
  emptyActivationFunnel,
  fetchActivationFunnel,
  loopFromRpc,
  pct,
  rowFromRpc,
  sumRows,
  windowsFor,
} from "./activation-funnel";

const NOW = new Date("2026-09-02T12:00:00.000Z");

describe("windowsFor", () => {
  it("builds three windows ending now, with prior30d ending exactly where last30d starts", () => {
    const w = windowsFor(NOW);
    expect(w.last7d.to).toBe(NOW.toISOString());
    expect(w.last30d.to).toBe(NOW.toISOString());
    expect(w.prior30d.to).toBe(w.last30d.from);
    expect(new Date(w.last7d.from).getTime()).toBe(NOW.getTime() - 7 * 86_400_000);
    expect(new Date(w.last30d.from).getTime()).toBe(NOW.getTime() - 30 * 86_400_000);
    expect(new Date(w.prior30d.from).getTime()).toBe(NOW.getTime() - 60 * 86_400_000);
  });
});

describe("rowFromRpc", () => {
  it("maps snake_case bigints (number or string) and defaults everything else to 0", () => {
    const row = rowFromRpc({
      provider: "google",
      signups: 99,
      confirmed: "99",
      reached_wizard: 97,
      generated: 79,
      has_trip: 79,
      generated_no_trip: 3,
      save_failed_users: null,
    });
    expect(row).toEqual({
      provider: "google",
      signups: 99,
      confirmed: 99,
      reachedWizard: 97,
      generated: 79,
      hasTrip: 79,
      generatedNoTrip: 3,
      saveFailedUsers: 0,
    });
    expect(rowFromRpc({}).provider).toBe("unknown");
  });
});

describe("sumRows / buildFunnelWindow", () => {
  const raw = [
    { provider: "email", signups: 47, confirmed: 37, reached_wizard: 28, generated: 23, has_trip: 20, generated_no_trip: 3, save_failed_users: 0 },
    { provider: "google", signups: 99, confirmed: 99, reached_wizard: 97, generated: 82, has_trip: 79, generated_no_trip: 3, save_failed_users: 1 },
  ];

  it("totals every column and sorts providers by signups descending", () => {
    const w = buildFunnelWindow({ days: 30, from: "a", to: "b" }, raw);
    expect(w.byProvider.map((r) => r.provider)).toEqual(["google", "email"]);
    expect(w.total).toEqual({
      provider: "all",
      signups: 146,
      confirmed: 136,
      reachedWizard: 125,
      generated: 105,
      hasTrip: 99,
      generatedNoTrip: 6,
      saveFailedUsers: 1,
    });
  });

  it("tolerates a null or malformed payload", () => {
    expect(buildFunnelWindow({ days: 7, from: "a", to: "b" }, null).total).toEqual(sumRows([]));
    expect(buildFunnelWindow({ days: 7, from: "a", to: "b" }, [null, 3, "x"]).byProvider).toEqual([]);
  });
});

describe("loopFromRpc", () => {
  it("reads the single-row payload whether it arrives as an array or an object", () => {
    const src = { anon_created: 55, anon_visited: 40, share_visits: 468, plan_own_clicks: 12, claimed: 0, claimed_any: 0, unclaimed_live: 55, expired: 0 };
    expect(loopFromRpc(30, [src])).toEqual(loopFromRpc(30, src));
    expect(loopFromRpc(30, [src]).shareVisits).toBe(468);
    expect(loopFromRpc(30, undefined).anonCreated).toBe(0);
  });
});

describe("pct", () => {
  it("is one-decimal and never divides by zero", () => {
    expect(pct(79, 99)).toBe(79.8);
    expect(pct(0, 0)).toBe(0);
    expect(pct(5, 0)).toBe(0);
  });
});

function fakeClient(impl: (fn: string, args?: Record<string, unknown>) => { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn((fn: string, args?: Record<string, unknown>) => Promise.resolve(impl(fn, args)));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("fetchActivationFunnel", () => {
  it("issues five calls with the three windows and assembles the block", async () => {
    const funnelRow = { provider: "google", signups: 10, confirmed: 10, reached_wizard: 9, generated: 8, has_trip: 7, generated_no_trip: 1, save_failed_users: 0 };
    const loopRow = { anon_created: 5, anon_visited: 3, share_visits: 9, plan_own_clicks: 1, claimed: 1, claimed_any: 1, unclaimed_live: 4, expired: 0 };
    const { client, rpc } = fakeClient((fn) => ({ data: fn === "get_activation_funnel" ? [funnelRow] : [loopRow], error: null }));

    const out = await fetchActivationFunnel(client, NOW);
    expect(out.available).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(5);
    const w = windowsFor(NOW);
    expect(rpc).toHaveBeenCalledWith("get_activation_funnel", { p_from: w.last7d.from, p_to: w.last7d.to });
    expect(rpc).toHaveBeenCalledWith("get_activation_funnel", { p_from: w.prior30d.from, p_to: w.prior30d.to });
    expect(rpc).toHaveBeenCalledWith("get_anonymous_loop", { p_from: w.last30d.from, p_to: w.last30d.to });
    expect(out.last30d.total.hasTrip).toBe(7);
    expect(out.anonymousLoop.last30d.claimed).toBe(1);
  });

  it("returns available:false (not zeros dressed as data) when any call errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient((fn, args) =>
      fn === "get_anonymous_loop" && args?.p_from === windowsFor(NOW).prior30d.from
        ? { data: null, error: { message: "function public.get_anonymous_loop does not exist" } }
        : { data: [], error: null },
    );
    const out = await fetchActivationFunnel(client, NOW);
    expect(out.available).toBe(false);
    expect(out).toEqual(emptyActivationFunnel(NOW));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns available:false when the client throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = { rpc: () => Promise.reject(new Error("network")) } as unknown as SupabaseClient;
    const out = await fetchActivationFunnel(client, NOW);
    expect(out.available).toBe(false);
    spy.mockRestore();
  });
});
