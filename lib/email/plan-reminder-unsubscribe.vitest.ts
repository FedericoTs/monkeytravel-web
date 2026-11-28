/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac, randomBytes } from "crypto";
import {
  buildPlanReminderUnsubscribeUrl,
  signParticipantUnsubscribeToken,
  signPlanReminderUnsubscribeToken,
  signUnsubscribeToken,
  verifyParticipantUnsubscribeToken,
  verifyPlanReminderUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe";
import { signDayLink } from "@/lib/trips/day-link";

/**
 * The way out of a kept plan's reminders: a signed link to one plan_reminders
 * row, which the /unsubscribe page deletes on confirming. It shares its secret
 * with the account tokens, the guest tokens and the day links, so each kind
 * must refuse the others.
 */

// Generated per run: no key-shaped literal in the source.
const SECRET = randomBytes(32).toString("hex");
const ROW = "2c9e7a41-5b3d-4f8e-9a1c-6d4b2e8f0a73";
const OTHER_ROW = "8e1f4d2a-3c6b-4a9e-b7d5-0f2c9a6e1b48";
const TRIP = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
const FAR_FUTURE = 4_102_444_800; // 2100-01-01, unix seconds

const payloadOf = (body: object) => Buffer.from(JSON.stringify(body)).toString("base64url");

beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("a reminder's token", () => {
  it("verifies to its row", () => {
    expect(verifyPlanReminderUnsubscribeToken(signPlanReminderUnsubscribeToken(ROW))).toEqual({
      ok: true,
      reminderId: ROW,
    });
  });

  it("lasts a year", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 26) });
    const token = signPlanReminderUnsubscribeToken(ROW);
    vi.setSystemTime(Date.UTC(2027, 10, 25));
    expect(verifyPlanReminderUnsubscribeToken(token).ok).toBe(true);
    vi.setSystemTime(Date.UTC(2027, 10, 27));
    expect(verifyPlanReminderUnsubscribeToken(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("is the token of a link to the /unsubscribe page", () => {
    const url = new URL(buildPlanReminderUnsubscribeUrl(ROW, "https://monkeytravel.app"));
    expect(`${url.origin}${url.pathname}`).toBe("https://monkeytravel.app/unsubscribe");
    expect(verifyPlanReminderUnsubscribeToken(url.searchParams.get("token") ?? "")).toEqual({
      ok: true,
      reminderId: ROW,
    });
  });
});

describe("tampering", () => {
  it("cannot be moved to another row or extended", () => {
    const [, mac] = signPlanReminderUnsubscribeToken(ROW).split(".");
    for (const payload of [
      payloadOf({ t: "plan_reminder", p: OTHER_ROW, e: FAR_FUTURE }),
      payloadOf({ t: "plan_reminder", p: ROW, e: FAR_FUTURE }),
    ]) {
      expect(verifyPlanReminderUnsubscribeToken(`${payload}.${mac}`)).toEqual({ ok: false, reason: "signature" });
    }
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of [null, undefined, "", "abc", ".abc", "abc.", "a.b.c"]) {
      expect(verifyPlanReminderUnsubscribeToken(bad as string)).toEqual({ ok: false, reason: "format" });
    }
  });

  it("refuses a well-signed payload of another kind or with no row id", () => {
    const mac = (payload: string) =>
      createHmac("sha256", SECRET).update(`mt-plan-reminder-unsub:v1|${payload}`).digest("base64url");
    for (const body of [
      { t: "participant", p: ROW, e: FAR_FUTURE },
      { t: "plan_reminder", p: "not-a-uuid", e: FAR_FUTURE },
      { t: "plan_reminder", p: ROW },
    ]) {
      const payload = payloadOf(body);
      expect(verifyPlanReminderUnsubscribeToken(`${payload}.${mac(payload)}`)).toEqual({ ok: false, reason: "format" });
    }
  });
});

describe("one secret, several kinds of signed link", () => {
  it("a guest's token is not a reminder's, and a reminder's is not a guest's", () => {
    expect(verifyPlanReminderUnsubscribeToken(signParticipantUnsubscribeToken(ROW))).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(verifyParticipantUnsubscribeToken(signPlanReminderUnsubscribeToken(ROW))).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("an account's token is not a reminder's, and a reminder's is not an account's", () => {
    expect(verifyPlanReminderUnsubscribeToken(signUnsubscribeToken(OTHER_ROW, "tripReminders"))).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(verifyUnsubscribeToken(signPlanReminderUnsubscribeToken(ROW))).toEqual({ ok: false, reason: "signature" });
  });

  it("a day link is not a reminder's token", () => {
    expect(verifyPlanReminderUnsubscribeToken(signDayLink(TRIP, "2026-12-14"))).toEqual({
      ok: false,
      reason: "signature",
    });
  });
});

describe("without a usable secret", () => {
  it("signs nothing and verifies nothing", () => {
    const token = signPlanReminderUnsubscribeToken(ROW);
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "too-short");
    expect(() => signPlanReminderUnsubscribeToken(ROW)).toThrow(/EMAIL_UNSUBSCRIBE_SECRET/);
    expect(verifyPlanReminderUnsubscribeToken(token)).toEqual({ ok: false, reason: "secret_missing" });
  });

  it("refuses to sign something that is not a row id", () => {
    expect(() => signPlanReminderUnsubscribeToken("not-a-uuid")).toThrow(/invalid reminder id/);
  });
});
