import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The link inside the sign-in email.
 *
 * Until 2026-09-24 the hook copied the whole redirect_to path into the
 * callback's `next`. The save prompt's redirect_to IS a callback URL, so the
 * email linked /auth/callback?token_hash=...&next=/auth/callback?next=/trips/new.
 * The first callback signed the user in, the second had no code, and a
 * signed-in user landed on /auth/login?error=auth_incomplete. For es/it/pt the
 * nested URL was /pt/auth/callback, which is a 404. These drive the real
 * route with the signature check and the email provider mocked out.
 */

const sendEmail = vi.fn();
vi.mock("@/lib/email/client", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/email/verify-hook", () => ({ verifyHookSignature: () => ({ ok: true }) }));
vi.mock("@react-email/render", () => ({ render: async () => "<html></html>" }));

import { POST } from "./route";

const APP = "https://monkeytravel.app";

function hookRequest(redirectTo: string, userMetadata: Record<string, unknown> = {}, type = "magiclink") {
  const body = JSON.stringify({
    user: { email: "planner@example.com", user_metadata: userMetadata },
    email_data: {
      token: "123456",
      token_hash: "hash_abc",
      redirect_to: redirectTo,
      email_action_type: type,
      site_url: APP,
    },
  });
  return new Request(`${APP}/api/auth/send-email`, {
    method: "POST",
    body,
    headers: { "webhook-id": "x", "webhook-timestamp": "0", "webhook-signature": "v1,x" },
  });
}

/** The callback link printed in the plain-text body. */
async function emailedLink(redirectTo: string, meta?: Record<string, unknown>, type?: string): Promise<URL> {
  const res = await POST(hookRequest(redirectTo, meta, type));
  expect(res.status).toBe(200);
  const { text } = sendEmail.mock.calls.at(-1)![0] as { text: string };
  const href = text.match(/https:\/\/monkeytravel\.app\/auth\/callback\?[^\s)]+/);
  expect(href, "no callback link in the email").toBeTruthy();
  return new URL(href![0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SEND_EMAIL_HOOK_SECRET = "v1,whsec_test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_APP_URL = APP;
  sendEmail.mockResolvedValue({ ok: true });
});

describe("the save prompt's emailed link", () => {
  it("goes straight to the destination, not through a second callback", async () => {
    const link = await emailedLink(`${APP}/auth/callback?next=%2Ftrips%2Fnew&locale=en`);
    expect(link.searchParams.get("next")).toBe("/trips/new");
    expect(link.searchParams.get("token_hash")).toBe("hash_abc");
    expect(link.searchParams.get("type")).toBe("magiclink");
  });

  it("carries a Portuguese sign-in's language to the landing page", async () => {
    const link = await emailedLink(`${APP}/auth/callback?next=%2Ftrips%2Fnew&locale=pt`);
    expect(link.searchParams.get("next")).toBe("/trips/new");
    expect(link.searchParams.get("locale")).toBe("pt");
  });

  it("repairs a redirect built before the fix (/pt/auth/callback)", async () => {
    const link = await emailedLink(`${APP}/pt/auth/callback?next=%2Ftrips%2Fnew`);
    expect(link.searchParams.get("next")).toBe("/trips/new");
    expect(link.searchParams.get("locale")).toBe("pt");
  });

  it("writes the email in the sign-in's language when the account has none stored", async () => {
    await emailedLink(`${APP}/auth/callback?next=%2Ftrips%2Fnew&locale=pt`);
    const { subject: pt } = sendEmail.mock.calls.at(-1)![0] as { subject: string };
    await emailedLink(`${APP}/auth/callback?next=%2Ftrips%2Fnew&locale=en`);
    const { subject: en } = sendEmail.mock.calls.at(-1)![0] as { subject: string };
    expect(pt).not.toBe(en);
  });

  it("lets the account's stored language win", async () => {
    await emailedLink(`${APP}/auth/callback?next=%2Ftrips%2Fnew&locale=en`, { locale: "it" });
    const { subject: it_ } = sendEmail.mock.calls.at(-1)![0] as { subject: string };
    await emailedLink(`${APP}/auth/callback?next=%2Ftrips%2Fnew&locale=it`);
    const { subject: itFromPage } = sendEmail.mock.calls.at(-1)![0] as { subject: string };
    expect(it_).toBe(itFromPage);
  });
});

describe("other redirects keep working", () => {
  it("a referred signup keeps its code and gets no made-up destination", async () => {
    const link = await emailedLink(`${APP}/auth/callback?ref=ABC123&locale=es`, { locale: "es" }, "signup");
    expect(link.searchParams.get("ref")).toBe("ABC123");
    expect(link.searchParams.has("next")).toBe(false);
    expect(link.searchParams.get("locale")).toBe("es");
  });

  it("the invite page's own URL stays the destination", async () => {
    const link = await emailedLink(`${APP}/pt/invite/tok123`);
    expect(link.searchParams.get("next")).toBe("/pt/invite/tok123");
  });

  it("the bare site URL adds nothing", async () => {
    const link = await emailedLink(APP, {}, "signup");
    expect(link.searchParams.has("next")).toBe(false);
    expect(link.searchParams.get("locale")).toBe("en");
  });
});
