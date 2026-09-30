/**
 * trackPageView(): which requests record a view and which only carry the
 * analytics session.
 *
 * A search result Chrome prefetched reaches us as a `Sec-Purpose: prefetch`
 * request and is never requested again when the visitor clicks it. That
 * request was skipped entirely, cookie included, so the visitor's whole visit
 * ran without a session and every wizard event landed as "no_session".
 */
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@vercel/functions", () => ({ geolocation: () => ({}) }));

const { trackPageView } = await import("./middleware");

const NAVIGATION = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };
const PREFETCH = { ...NAVIGATION, "sec-purpose": "prefetch" };
const ROUTER_FETCH = { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" };

function request(path: string, headers: Record<string, string>, cookie?: string) {
  return new NextRequest(`https://monkeytravel.app${path}`, {
    headers: { ...headers, ...(cookie ? { cookie: `mt_session_id=${cookie}` } : {}) },
  });
}

const recorded = vi.fn(async () => new Response(null, { status: 201 }));

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  recorded.mockClear();
  vi.stubGlobal("fetch", recorded);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("trackPageView", () => {
  it("gives a prefetched landing a session without counting a view", () => {
    const { sessionId, label } = trackPageView(request("/", PREFETCH));
    expect(label).toBe("skip:prefetch");
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(recorded).not.toHaveBeenCalled();
  });

  it("lets a router fetch restore a missing session, and keeps an existing one", () => {
    expect(trackPageView(request("/trips/new", ROUTER_FETCH)).sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(trackPageView(request("/trips/new", ROUTER_FETCH, "kept-id")).sessionId).toBe("kept-id");
    expect(recorded).not.toHaveBeenCalled();
  });

  it("records a navigation once, under the visitor's session", () => {
    const { sessionId, label } = trackPageView(request("/blog", NAVIGATION, "kept-id"));
    expect(label).toBe("counted");
    expect(sessionId).toBe("kept-id");
    expect(recorded).toHaveBeenCalledTimes(1);
  });

  it("gives API calls no session", () => {
    expect(trackPageView(request("/api/wizard-event", NAVIGATION)).sessionId).toBeNull();
  });

  it("mints nothing and records nothing outside production", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(trackPageView(request("/", PREFETCH)).sessionId).toBeNull();
    expect(trackPageView(request("/blog", NAVIGATION)).sessionId).toBeNull();
    expect(recorded).not.toHaveBeenCalled();
  });
});
