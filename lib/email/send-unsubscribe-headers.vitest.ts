/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { fakeSupabase } from "@/tests/fake-supabase";
import type { SendInput } from "./client";
import { buildParticipantUnsubscribeUrl, verifyUnsubscribeToken } from "./unsubscribe";

/**
 * Every opt-out-able email names its way out twice: the footer link, and the
 * List-Unsubscribe headers a mail client turns into its own one-click button
 * (RFC 8058). An account gets its own link; a trip's guest, who has no
 * account, gets the link the caller minted for their "I'm going" row.
 */

const sendEmail = vi.fn();
vi.mock("./client", () => ({ sendEmail: (input: unknown) => sendEmail(input) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    fakeSupabase((q) => {
      if (q.table === "users") return { data: { notification_settings: {}, preferred_language: "en" }, error: null };
      if (q.table === "email_log" && q.op === "insert") return { data: { id: "log-1" }, error: null };
      // No earlier send under this key, and the address never bounced.
      return { data: q.end === "list" ? [] : null, error: null };
    }).client,
}));

const { dispatchEmail } = await import("./send");

const ROW = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const USER = "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f6e";

const digest = {
  id: "trip_day_digest" as const,
  props: {
    day: 3,
    destination: "Lisbon",
    heading: "Tomorrow: Day 3",
    intro: "Here's what tomorrow looks like.",
    emptyLine: "Nothing planned for day 3 yet — open your trip to fill it in.",
    ctaLabel: "See tomorrow's plan",
    tripUrl: "https://monkeytravel.app/shared/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d?slot=in_trip_day_3",
  },
};

async function sent(options: { recipientUserId: string | null; guestUnsubscribeUrl?: string }): Promise<SendInput> {
  const outcome = await dispatchEmail({ recipientEmail: "guest@example.com", template: digest, ...options });
  expect(outcome.status).toBe("sent");
  return sendEmail.mock.calls.at(-1)![0] as SendInput;
}

beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, messageId: "msg-1" });
});

afterEach(() => vi.unstubAllEnvs());

describe("a guest's digest", () => {
  it("carries the guest's link in the headers and the footer", async () => {
    const link = buildParticipantUnsubscribeUrl(ROW, "https://monkeytravel.app");
    const email = await sent({ recipientUserId: null, guestUnsubscribeUrl: link });
    expect(email.headers).toEqual({
      "List-Unsubscribe": `<${link}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(email.html).toContain(`href="${link}"`);
    expect(email.text).toContain(link);
    expect(email.html).not.toContain("/profile/notifications");
  });

  it("without one, gets no headers and the account-only settings link", async () => {
    const email = await sent({ recipientUserId: null });
    expect(email.headers).toBeUndefined();
    expect(email.html).toContain("/profile/notifications");
  });
});

describe("a signed-in participant's digest", () => {
  it("keeps the account's own link, even when a guest link is passed", async () => {
    const guestLink = buildParticipantUnsubscribeUrl(ROW, "https://monkeytravel.app");
    const email = await sent({ recipientUserId: USER, guestUnsubscribeUrl: guestLink });
    const header = email.headers?.["List-Unsubscribe"] ?? "";
    expect(header).not.toContain(guestLink);
    expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const token = new URL(header.slice(1, -1)).searchParams.get("token") ?? "";
    expect(verifyUnsubscribeToken(token).payload).toMatchObject({ u: USER, k: "tripReminders" });
    expect(email.html).not.toContain(guestLink);
  });
});
