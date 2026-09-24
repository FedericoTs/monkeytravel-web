// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Emailing a sign-in link to the address an invite was sent to.
 *
 * The invite page for an emailed invite told a signed-out visitor to "sign
 * in with that email" and gave them nowhere to do it. This route is the way
 * in: it only ever mails the invited address, never reveals it, and lands the
 * link back on the invite.
 */

const INVITED = "invitee.person@example.com";
let inviteRow: Record<string, unknown> | null;
const signInWithOtp = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, key: string) =>
    key === "service-key"
      ? { rpc: async () => ({ data: inviteRow ? [inviteRow] : [], error: null }) }
      : { auth: { signInWithOtp: (...a: unknown[]) => signInWithOtp(...a) } },
}));

import { POST } from "./route";

let n = 0;
function call(token: string, body: unknown = { locale: "pt" }, ip = `10.0.0.${++n}`) {
  return POST(
    new NextRequest(`https://monkeytravel.app/api/invites/${token}/sign-in-link`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ token }) } as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  inviteRow = { recipient_email: INVITED, trip_id: "t1", role: "editor" };
  signInWithOtp.mockResolvedValue({ error: null });
});

describe("POST /api/invites/[token]/sign-in-link", () => {
  it("mails the INVITED address a link that lands back on the invite, signed in", async () => {
    const res = await call("tokenAAAA1");
    expect(res.status).toBe(200);
    const [{ email, options }] = signInWithOtp.mock.calls[0];
    expect(email).toBe(INVITED);
    const back = new URL(options.emailRedirectTo);
    expect(back.pathname).toBe("/auth/callback");
    expect(back.searchParams.get("next")).toBe("/invite/tokenAAAA1");
    expect(back.searchParams.get("locale")).toBe("pt");
    // A brand-new address gets an account, in the page's language.
    expect(options.shouldCreateUser).toBe(true);
    expect(options.data).toEqual({ locale: "pt" });
  });

  it("answers with a masked hint, never the address", async () => {
    const body = await (await call("tokenAAAA2")).json();
    const text = JSON.stringify(body);
    expect(text).not.toContain(INVITED);
    expect((body.data ?? body).sentTo).toBe("i•••n@example.com");
  });

  it("refuses an invite that is no longer usable", async () => {
    inviteRow = null;
    expect((await call("tokenAAAA3")).status).toBe(404);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("refuses a shareable-link invite (no address to mail)", async () => {
    inviteRow = { recipient_email: null };
    expect((await call("tokenAAAA4")).status).toBe(400);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("refuses a malformed token", async () => {
    expect((await call("bad token!")).status).toBe(400);
  });

  it("sends at most 3 an hour per invite, whoever asks", async () => {
    for (let i = 0; i < 3; i++) expect((await call("tokenLIMIT1", { locale: "en" }, `10.9.9.${i}`)).status).toBe(200);
    expect((await call("tokenLIMIT1", { locale: "en" }, "10.9.9.99")).status).toBe(429);
    expect(signInWithOtp).toHaveBeenCalledTimes(3);
  });

  it("passes the auth provider's own rate limit through as 429", async () => {
    signInWithOtp.mockResolvedValue({ error: { status: 429, message: "email rate limit exceeded" } });
    expect((await call("tokenAAAA5")).status).toBe(429);
  });

  it("falls back to English for an unknown locale", async () => {
    await call("tokenAAAA6", { locale: "de" });
    const { options } = signInWithOtp.mock.calls[0][0];
    expect(new URL(options.emailRedirectTo).searchParams.get("locale")).toBe("en");
  });
});
