// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { deleteAccountCodeCopy } from "@/lib/email/copy";

/**
 * The code that confirms an account deletion is minted without Supabase
 * sending its own sign-in email, and arrives in an email that says what it is
 * for, in the language of the page it was asked from.
 */

const USER = { id: "user-1", email: "traveler@example.com" };

const generateLink = vi.fn(async () => ({
  data: { properties: { email_otp: "482915" } } as { properties?: { email_otp?: string } } | null,
  error: null as { message: string } | null,
}));
type Mail = { to: string; subject: string; html: string; text: string };
const sendEmail = vi.fn<(input: Mail) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
let allowed = true;

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: USER, errorResponse: null }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink } } }),
}));
vi.mock("@/lib/email/client", () => ({
  sendEmail: (input: Mail) => sendEmail(input),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed, remaining: allowed ? 1 : 0 }) }),
}));

async function post(body: unknown, site = "same-origin") {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/profile/delete/code", {
      method: "POST",
      headers: { "sec-fetch-site": site, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  allowed = true;
});

describe("POST /api/profile/delete/code", () => {
  it("emails the signed-in user their code, in the page's language", async () => {
    const { status } = await post({ locale: "it" });
    expect(status).toBe(200);
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: USER.email });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe(USER.email);
    expect(mail.subject).toBe(deleteAccountCodeCopy.it.subject);
    expect(mail.html).toContain("482915");
    expect(mail.text).toContain("482915");
  });

  it("falls back to English for an unknown language", async () => {
    await post({ locale: "xx" });
    expect(sendEmail.mock.calls[0][0].subject).toBe(deleteAccountCodeCopy.en.subject);
  });

  it("sends nothing when no code could be made", async () => {
    generateLink.mockResolvedValueOnce({ data: null, error: { message: "User not found" } });
    const { status } = await post({ locale: "en" });
    expect(status).toBe(500);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("limits how many codes can be asked for", async () => {
    allowed = false;
    const { status } = await post({ locale: "en" });
    expect(status).toBe(429);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("refuses a request from another site", async () => {
    const { status } = await post({ locale: "en" }, "cross-site");
    expect(status).toBe(403);
    expect(generateLink).not.toHaveBeenCalled();
  });
});
