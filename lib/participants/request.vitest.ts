/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isCookielessScript, participantCookieId, readParticipantWrite, setParticipantCookie, signedInUser } from "./request";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }),
}));
let getUser: () => Promise<unknown>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: () => getUser() } }),
}));

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

describe("what every anonymous write checks first", () => {
  const TOKEN = "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f6e";
  const BROWSER = "Mozilla/5.0 (Macintosh)";
  const context = (token: string) => ({ params: Promise.resolve({ token }) });
  const write = (body: string, agent = BROWSER) =>
    new NextRequest("https://monkeytravel.app/api/shared/t/vote", { method: "POST", body, headers: { "user-agent": agent } });
  const limiter = (allowed = true) => ({ check: vi.fn(async () => ({ allowed })) });
  type Limiter = Parameters<typeof readParticipantWrite>[2];
  const statusOf = async (out: Awaited<ReturnType<typeof readParticipantWrite>>) => out.errorResponse?.status;

  afterEach(() => {
    cookieValue = undefined;
  });

  it("hands back the token, the body and the cookie", async () => {
    cookieValue = "participant-1";
    const out = await readParticipantWrite<{ a: number }>(write('{"a":1}', "curl/8"), context(TOKEN), limiter() as unknown as Limiter);
    expect(out).toMatchObject({ token: TOKEN, body: { a: 1 }, existingCookie: "participant-1" });
  });

  it("refuses a malformed token before counting it against the limit", async () => {
    const ip = limiter();
    const out = await readParticipantWrite(write("{}"), context("not-a-uuid"), ip as unknown as Limiter);
    expect(await statusOf(out)).toBe(400);
    expect(ip.check).not.toHaveBeenCalled();
  });

  it("refuses over the limit, in the route's words", async () => {
    const out = await readParticipantWrite(write("{}"), context(TOKEN), limiter(false) as unknown as Limiter, "Too many votes.");
    expect(await statusOf(out)).toBe(429);
    expect((await out.errorResponse?.json()).error).toBe("Too many votes.");
  });

  it("refuses a cookieless script", async () => {
    const out = await readParticipantWrite(write("{}", "curl/8"), context(TOKEN), limiter() as unknown as Limiter);
    expect(await statusOf(out)).toBe(400);
    expect((await out.errorResponse?.json()).error).toBe("Invalid request");
  });

  it.each(["not json", "null", "3"])("refuses a body that is not an object: %s", async (body) => {
    const out = await readParticipantWrite(write(body), context(TOKEN), limiter() as unknown as Limiter);
    expect(await statusOf(out)).toBe(400);
    expect((await out.errorResponse?.json()).error).toBe("Invalid request body");
  });
});

describe("the account behind a request", () => {
  it("is the signed-in user", async () => {
    getUser = async () => ({ data: { user: { id: "u1", email: "a@example.com" } } });
    expect(await signedInUser()).toEqual({ id: "u1", email: "a@example.com" });
  });

  it("is nobody when signed out, or when it can't be read", async () => {
    getUser = async () => ({ data: { user: null } });
    expect(await signedInUser()).toBeNull();
    getUser = async () => {
      throw new Error("down");
    };
    expect(await signedInUser()).toBeNull();
  });
});
