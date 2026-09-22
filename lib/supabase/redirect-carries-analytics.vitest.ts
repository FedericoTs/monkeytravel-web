/**
 * A middleware redirect must carry the analytics session cookie.
 *
 * updateSession() records the page view and sets `mt_session_id` on
 * `supabaseResponse`, and four branches then return a FRESH
 * NextResponse.redirect(). A fresh response carries none of the first one's
 * cookies, so before 2026-09-22 those views landed under a session id that
 * was never persisted: the visitor's next request minted another one, and
 * that request carried a same-origin Referer. Measured 18-21 Sep: 56
 * anonymous views across 54 distinct sessions on redirect-prone /trips*
 * paths, ~14/day.
 *
 * This asserts the carrying behaviour on the real NextResponse objects rather
 * than on a mock, because the bug was precisely that two real response objects
 * do not share state.
 */
import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";

/** The helper's shape, kept in step with lib/supabase/middleware.ts. */
function carryAnalytics(source: NextResponse, redirect: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  const pv = source.headers.get("x-mt-pv");
  if (pv) redirect.headers.set("x-mt-pv", pv);
  return redirect;
}

function sourceWithSession(sessionId: string): NextResponse {
  const res = NextResponse.next();
  res.headers.set("x-mt-pv", "counted");
  res.cookies.set("mt_session_id", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

describe("a redirect carries the analytics session", () => {
  it("loses the cookie without the helper — the bug this fixes", () => {
    const source = sourceWithSession("11111111-1111-4111-8111-111111111111");
    const redirect = NextResponse.redirect("https://monkeytravel.app/auth/login");
    expect(source.cookies.get("mt_session_id")?.value).toBe("11111111-1111-4111-8111-111111111111");
    expect(redirect.cookies.get("mt_session_id")).toBeUndefined();
    expect(redirect.headers.get("x-mt-pv")).toBeNull();
  });

  it("carries the session cookie onto the redirect", () => {
    const source = sourceWithSession("22222222-2222-4222-8222-222222222222");
    const redirect = carryAnalytics(source, NextResponse.redirect("https://monkeytravel.app/auth/login"));
    expect(redirect.cookies.get("mt_session_id")?.value).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("carries the page-view verdict, which is how a preview is probed", () => {
    const source = sourceWithSession("33333333-3333-4333-8333-333333333333");
    const redirect = carryAnalytics(source, NextResponse.redirect("https://monkeytravel.app/"));
    expect(redirect.headers.get("x-mt-pv")).toBe("counted");
  });

  it("carries every cookie, not just ours — a refreshed auth token rides here too", () => {
    const source = sourceWithSession("44444444-4444-4444-8444-444444444444");
    source.cookies.set("sb-abc-auth-token", "refreshed", { path: "/" });
    const redirect = carryAnalytics(source, NextResponse.redirect("https://monkeytravel.app/trips"));
    expect(redirect.cookies.get("sb-abc-auth-token")?.value).toBe("refreshed");
    expect(redirect.cookies.get("mt_session_id")?.value).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("does not invent a verdict header when the source has none", () => {
    const source = NextResponse.next();
    const redirect = carryAnalytics(source, NextResponse.redirect("https://monkeytravel.app/"));
    expect(redirect.headers.get("x-mt-pv")).toBeNull();
  });
});
