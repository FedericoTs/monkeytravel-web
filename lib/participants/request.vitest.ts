/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isCookielessScript, participantCookieId, setParticipantCookie } from "./request";

const request = (agent?: string) =>
  new NextRequest("https://monkeytravel.app/api/shared/t/vote", { method: "POST", headers: agent ? { "user-agent": agent } : {} });

describe("a script's first write", () => {
  it.each(["curl/8.4.0", "Wget/1.21", "python-requests/2.31", "HTTPie/3.2", "Go-http-client/2.0", "libwww-perl/6.7", "Scrapy/2.11"])(
    "is refused from %s without a cookie",
    (agent) => expect(isCookielessScript(request(agent), undefined)).toBe(true)
  );

  it("is refused without a user agent", () => {
    expect(isCookielessScript(request(), undefined)).toBe(true);
  });

  it("lets a browser's first write through, even one mentioning a tool later in its agent", () => {
    expect(isCookielessScript(request("Mozilla/5.0 (Macintosh)"), undefined)).toBe(false);
    expect(isCookielessScript(request("Mozilla/5.0 curl-ish"), undefined)).toBe(false);
  });

  it("lets anyone through who already has the participant cookie", () => {
    expect(isCookielessScript(request("curl/8.4.0"), "K".repeat(21))).toBe(false);
    expect(isCookielessScript(request(), "K".repeat(21))).toBe(false);
  });
});

describe("the participant's cookie id", () => {
  it.each([10, 21, 60])("keeps one of %i characters", (n) => {
    expect(participantCookieId("k".repeat(n))).toEqual({ cookieId: "k".repeat(n), issued: false });
  });

  it.each([undefined, "", "k".repeat(9), "k".repeat(61)])("issues a new one for %j", (value) => {
    const { cookieId, issued } = participantCookieId(value);
    expect(issued).toBe(true);
    expect(cookieId).toHaveLength(21);
    expect(cookieId).not.toBe(value);
  });
});

describe("keeping a new participant id", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sets the year-long httpOnly cookie, secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const set = vi.fn();
    setParticipantCookie({ set } as never, "N".repeat(21));
    expect(set).toHaveBeenCalledWith({
      name: "mt_anon_voter",
      value: "N".repeat(21),
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  });
});
