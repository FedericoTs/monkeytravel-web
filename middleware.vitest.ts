/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Every email's List-Unsubscribe header names the /unsubscribe page, and a
 * mail client's one-click unsubscribe (RFC 8058) is a POST to it. A page
 * renders a POST and changes nothing, so middleware hands that POST to
 * /api/unsubscribe, token and all. Anything else still reaches the page.
 */

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async (_request: NextRequest, response?: NextResponse) => response ?? NextResponse.next(),
  trackPageView: () => ({ sessionId: null, label: "test" }),
}));
// The locale step, which may redirect: a one-click POST must not go through it.
const intl = vi.fn((request: NextRequest) => {
  void request;
  return NextResponse.next();
});
vi.mock("@/lib/i18n/routing", () => ({ routing: { locales: ["en", "es", "it", "pt"], defaultLocale: "en" } }));
vi.mock("next-intl/middleware", () => ({ default: () => (request: NextRequest) => intl(request) }));

const { middleware } = await import("./middleware");

const TOKEN = "abc.def";

function oneClick(path: string, headers: Record<string, string> = {}) {
  return middleware(
    new NextRequest(`https://monkeytravel.app${path}?token=${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: "List-Unsubscribe=One-Click",
    })
  );
}

const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

beforeEach(() => intl.mockClear());

describe("a one-click unsubscribe POST", () => {
  it.each(["/unsubscribe", "/es/unsubscribe", "/pt/unsubscribe"])("on %s reaches the API with its token", async (path) => {
    const res = await oneClick(path);
    expect(res.status).toBe(200);
    expect(rewrittenTo(res)).toBe(`https://monkeytravel.app/api/unsubscribe?token=${TOKEN}`);
    expect(intl).not.toHaveBeenCalled();
  });
});

describe("everything else on the page", () => {
  it("a person opening the link gets the confirmation page", async () => {
    const res = await middleware(new NextRequest(`https://monkeytravel.app/unsubscribe?token=${TOKEN}`));
    expect(rewrittenTo(res) ?? "").not.toContain("/api/unsubscribe");
    expect(intl).toHaveBeenCalledTimes(1);
  });

  it("a server action posted from the page stays on the page", async () => {
    const res = await oneClick("/unsubscribe", { "next-action": "abc123" });
    expect(rewrittenTo(res) ?? "").not.toContain("/api/unsubscribe");
    expect(intl).toHaveBeenCalledTimes(1);
  });

  it("other POSTs are untouched", async () => {
    const res = await oneClick("/unsubscribe-me");
    expect(rewrittenTo(res) ?? "").not.toContain("/api/unsubscribe");
  });
});
