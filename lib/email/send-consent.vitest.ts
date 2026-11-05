/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import type { SendInput } from "./client";
import { verifyUnsubscribeToken } from "./unsubscribe";

/**
 * Whether an email may go at all, decided in one place. Someone who opted into
 * reminders for a trip they booked hasn't agreed to be marketed to after it ends,
 * and an unsubscribe has to write the preference the email was sent under. What it
 * can't read, it doesn't send: a dropped email is better than one to someone who
 * said no. Runs the real dispatch and templates, with the provider and database faked.
 */

const sendEmail = vi.fn();
vi.mock("./client", () => ({ sendEmail: (input: unknown) => sendEmail(input) }));

const s = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  bounced: false,
  alreadySent: false,
  refuse: null as ((q: { table: string; op: string; end: string }) => boolean) | null,
  logged: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    fakeSupabase((q: FakeQuery) => {
      if (q.op === "select" && s.refuse?.(q)) return { data: null, error: { message: "read failed" } };
      if (q.table === "users") return { data: { notification_settings: s.settings, preferred_language: "en" }, error: null };
      if (q.table === "email_log" && q.op === "insert") {
        s.logged.push(q.value as Record<string, unknown>);
        return { data: { id: "log-1" }, error: null };
      }
      if (q.table === "email_log" && q.end === "maybeSingle") {
        return { data: s.alreadySent ? { id: "log-0", status: "sent", message_id: "msg-0" } : null, error: null };
      }
      if (q.table === "email_log") return { data: s.bounced ? [{ id: "log-b" }] : [], error: null };
      return { data: q.end === "list" ? [] : null, error: null };
    }).client,
}));

const { dispatchEmail } = await import("./send");

const USER = "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f6e";
const shared = { destination: "Lisbon", heading: "Your trip", body: "Lisbon is coming up.", ctaLabel: "Open" };
const reminder = {
  id: "trip_reminder" as const,
  props: { ...shared, slot: "visa_check_7d" as const, tripUrl: "https://monkeytravel.app/trips/t1" },
};
const followup = {
  id: "trip_followup" as const,
  props: { ...shared, slot: "followup_return_3d" as const, ctaUrl: "https://monkeytravel.app/trips/t1" },
};
const digest = {
  id: "trip_day_digest" as const,
  props: {
    day: 3,
    destination: "Lisbon",
    heading: "Tomorrow: Day 3",
    intro: "Here's what tomorrow looks like.",
    emptyLine: "Nothing planned yet.",
    ctaLabel: "See tomorrow's plan",
    tripUrl: "https://monkeytravel.app/trips/t1",
  },
};
const TEMPLATES = { reminder, followup, digest };
type Name = keyof typeof TEMPLATES;

const dispatch = (name: Name, extra: Record<string, unknown> = {}) =>
  dispatchEmail({
    recipientEmail: "Owner@Example.com",
    recipientUserId: USER,
    template: TEMPLATES[name],
    ...extra,
  } as Parameters<typeof dispatchEmail>[0]);

beforeEach(() => {
  s.settings = {};
  s.bounced = false;
  s.alreadySent = false;
  s.refuse = null;
  s.logged.length = 0;
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, messageId: "msg-1" });
  for (const level of ["warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who said no to what", () => {
  it.each<[string, Name, Record<string, unknown>, string]>([
    ["no preferences set: sends", "reminder", {}, "sent"],
    ["no preferences set: sends", "followup", {}, "sent"],
    ["no to marketing stops the follow-up", "followup", { marketingNotifications: false }, "skipped_disabled"],
    ["no to reminders doesn't stop the follow-up", "followup", { tripReminders: false }, "sent"],
    ["no to reminders stops the reminder", "reminder", { tripReminders: false }, "skipped_disabled"],
    ["no to marketing doesn't stop the reminder", "reminder", { marketingNotifications: false }, "sent"],
    ["no to reminders stops the day digest", "digest", { tripReminders: false }, "skipped_disabled"],
    ["no to marketing doesn't stop the day digest", "digest", { marketingNotifications: false }, "sent"],
    ["no to all email stops the reminder", "reminder", { emailNotifications: false }, "skipped_disabled"],
    ["no to all email stops the follow-up", "followup", { emailNotifications: false }, "skipped_disabled"],
  ])("%s (%s)", async (_name, template, settings, status) => {
    s.settings = settings;
    const outcome = await dispatch(template);
    expect(outcome.status).toBe(status);
    expect(sendEmail).toHaveBeenCalledTimes(status === "sent" ? 1 : 0);
  });

  it("records a skip, to the address and under the template", async () => {
    s.settings = { marketingNotifications: false };
    await dispatch("followup");
    expect(s.logged).toEqual([expect.objectContaining({ recipient_email: "owner@example.com", template_id: "trip_followup", status: "skipped_disabled" })]);
  });
});

describe("the one-click unsubscribe", () => {
  it.each<[Name, string]>([
    ["followup", "marketingNotifications"],
    ["reminder", "tripReminders"],
    ["digest", "tripReminders"],
  ])("on the %s turns off %s: the preference it was sent under", async (template, key) => {
    await dispatch(template);
    const email = sendEmail.mock.calls[0][0] as SendInput;
    const header = email.headers?.["List-Unsubscribe"] ?? "";
    const token = new URL(header.slice(1, -1)).searchParams.get("token") ?? "";
    expect(verifyUnsubscribeToken(token).payload).toMatchObject({ u: USER, k: key });
  });
});

describe("what it can't confirm, it doesn't send", () => {
  it("the preferences can't be read", async () => {
    s.refuse = (q) => q.table === "users";
    expect(await dispatch("reminder")).toMatchObject({ ok: false, status: "failed" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("it can't be read whether this was already sent", async () => {
    s.refuse = (q) => q.table === "email_log" && q.end === "maybeSingle";
    expect(await dispatch("reminder", { idempotencyKey: "key-1" })).toMatchObject({
      ok: false,
      status: "failed",
      error: "idempotency check failed",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("it can't be read whether the address bounced", async () => {
    s.refuse = (q) => q.table === "email_log" && q.end === "list";
    expect(await dispatch("reminder")).toMatchObject({ ok: false, status: "failed", error: "suppression check failed" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("an address that bounced or complained is never sent to again", async () => {
    s.bounced = true;
    expect(await dispatch("reminder")).toMatchObject({ ok: true, status: "skipped_suppressed" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the same key doesn't send twice", async () => {
    s.alreadySent = true;
    expect(await dispatch("reminder", { idempotencyKey: "key-1" })).toMatchObject({ ok: true, status: "skipped_duplicate" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the check on the rendered email says no: nothing goes, and the row says why", async () => {
    const verify = vi.fn(() => ({ ok: false, reason: "poison_html" }));
    const outcome = await dispatch("reminder", { verify });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the check says yes: it goes", async () => {
    const outcome = await dispatch("reminder", { verify: () => ({ ok: true }) });
    expect(outcome.status).toBe("sent");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
