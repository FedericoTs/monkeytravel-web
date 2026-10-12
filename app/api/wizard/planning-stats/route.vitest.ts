/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * The wizard's "planned in the last 30 days" figure is the same for every
 * visitor, so the CDN holds it for an hour instead of the function running on
 * every wizard visit. That is only safe while the handler reads nothing from
 * the request, which the last test checks.
 */

const CDN_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

let answer: () => { data: unknown; error: unknown };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeSupabase(() => answer()).client,
}));

/** A fresh copy of the route, so its per-instance cache starts empty. */
async function loadGet() {
  vi.resetModules();
  return (await import("./route")).GET;
}

beforeEach(() => {
  answer = () => ({ data: 1753, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/wizard/planning-stats", () => {
  it("lets the CDN keep the figure for an hour and serve it stale while it refreshes", async () => {
    const GET = await loadGet();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CDN_CACHE);
    expect(await res.json()).toEqual({ plannedLast30d: 1000, cached: false });
  });

  it("sends the same header when the instance answers from its own cache", async () => {
    const GET = await loadGet();
    await GET();
    const res = await GET();
    expect(await res.json()).toEqual({ plannedLast30d: 1000, cached: true });
    expect(res.headers.get("cache-control")).toBe(CDN_CACHE);
  });

  it("a failed lookup hides the line and is cached like any other answer", async () => {
    answer = () => ({ data: null, error: { message: "canceling statement due to statement timeout" } });
    const GET = await loadGet();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plannedLast30d: null, cached: false });
    expect(res.headers.get("cache-control")).toBe(CDN_CACHE);
  });

  it("reads nothing from the request, so every visitor can share one response", async () => {
    const GET = await loadGet();
    expect(GET.length).toBe(0);
    const src = readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(src).not.toMatch(/next\/headers|cookies\(|headers\(\)|searchParams|nextUrl/);
  });
});
