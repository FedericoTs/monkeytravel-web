/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac, randomBytes } from "crypto";
import {
  buildParticipantUnsubscribeUrl,
  signParticipantUnsubscribeToken,
  signUnsubscribeToken,
  verifyParticipantUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe";
import { signDayLink, verifyDayLink } from "@/lib/trips/day-link";
import { signFeedbackToken } from "@/lib/feedback/token";

/**
 * A guest's way out of a trip's daily plan: a signed link to one
 * trip_participants row. It shares its secret with the account tokens, the
 * day links and the feedback links, so each kind must refuse the others.
 */

// Generated per run: no key-shaped literal in the source.
const SECRET = randomBytes(32).toString("hex");
const ROW = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const OTHER_ROW = "0b5c3a52-6f0e-4c1e-9d3b-8a7f6e5d4c3b";
const TRIP = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
const FAR_FUTURE = 4_102_444_800; // 2100-01-01, unix seconds

const payloadOf = (body: object) => Buffer.from(JSON.stringify(body)).toString("base64url");

beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", SECRET);
  vi.stubEnv("FEEDBACK_LINK_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("a guest token", () => {
  it("verifies to its row", () => {
    expect(verifyParticipantUnsubscribeToken(signParticipantUnsubscribeToken(ROW))).toEqual({
      ok: true,
      participantId: ROW,
    });
  });

  it("lasts a year, like an account's", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 10) });
    const token = signParticipantUnsubscribeToken(ROW);
    vi.setSystemTime(Date.UTC(2027, 9, 9));
    expect(verifyParticipantUnsubscribeToken(token).ok).toBe(true);
    vi.setSystemTime(Date.UTC(2027, 9, 11));
    expect(verifyParticipantUnsubscribeToken(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("is the token of a link to the /unsubscribe page", () => {
    const url = new URL(buildParticipantUnsubscribeUrl(ROW, "https://monkeytravel.app"));
    expect(`${url.origin}${url.pathname}`).toBe("https://monkeytravel.app/unsubscribe");
    expect(verifyParticipantUnsubscribeToken(url.searchParams.get("token") ?? "")).toEqual({
      ok: true,
      participantId: ROW,
    });
  });
});

describe("tampering", () => {
  it("cannot be moved to another row or extended", () => {
    const [, mac] = signParticipantUnsubscribeToken(ROW).split(".");
    for (const payload of [
      payloadOf({ t: "participant", p: OTHER_ROW, e: FAR_FUTURE }),
      payloadOf({ t: "participant", p: ROW, e: FAR_FUTURE }),
    ]) {
      expect(verifyParticipantUnsubscribeToken(`${payload}.${mac}`)).toEqual({ ok: false, reason: "signature" });
    }
  });

  it("rejects an altered signature", () => {
    const token = signParticipantUnsubscribeToken(ROW);
    const last = token.slice(-1);
    const flipped = token.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(verifyParticipantUnsubscribeToken(flipped)).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects a token signed with another secret", () => {
    const token = signParticipantUnsubscribeToken(ROW);
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
    expect(verifyParticipantUnsubscribeToken(token)).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of [null, undefined, "", "abc", ".abc", "abc.", "a.b.c", `${signParticipantUnsubscribeToken(ROW)}.x`]) {
      expect(verifyParticipantUnsubscribeToken(bad as string)).toEqual({ ok: false, reason: "format" });
    }
  });
});

describe("one secret, several kinds of signed link", () => {
  it("an account's token is not a guest's, and a guest's is not an account's", () => {
    expect(verifyParticipantUnsubscribeToken(signUnsubscribeToken(OTHER_ROW, "tripReminders"))).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(verifyUnsubscribeToken(signParticipantUnsubscribeToken(ROW))).toEqual({ ok: false, reason: "signature" });
  });

  it("a guest payload under an account token's signature is refused", () => {
    const payload = payloadOf({ t: "participant", p: ROW, e: FAR_FUTURE });
    const untagged = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(verifyParticipantUnsubscribeToken(`${payload}.${untagged}`)).toEqual({ ok: false, reason: "signature" });
  });

  it("a day link is not a guest token, and a guest token opens no day", () => {
    expect(verifyParticipantUnsubscribeToken(signDayLink(TRIP, "2026-10-14"))).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(verifyDayLink(TRIP, "2026-10-14", signParticipantUnsubscribeToken(ROW), Date.UTC(2026, 9, 13))).toEqual({
      ok: false,
      reason: "format",
    });
  });

  it("a feedback link is not a guest token", () => {
    expect(verifyParticipantUnsubscribeToken(signFeedbackToken(OTHER_ROW))).toEqual({ ok: false, reason: "signature" });
  });
});

describe("without a usable secret", () => {
  it("signs nothing and verifies nothing", () => {
    const token = signParticipantUnsubscribeToken(ROW);
    for (const value of ["", "too-short"]) {
      vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", value);
      expect(() => signParticipantUnsubscribeToken(ROW)).toThrow(/EMAIL_UNSUBSCRIBE_SECRET/);
      expect(() => buildParticipantUnsubscribeUrl(ROW)).toThrow();
      expect(verifyParticipantUnsubscribeToken(token)).toEqual({ ok: false, reason: "secret_missing" });
    }
  });

  it("refuses to sign something that is not a row id", () => {
    expect(() => signParticipantUnsubscribeToken("not-a-uuid")).toThrow();
  });
});
