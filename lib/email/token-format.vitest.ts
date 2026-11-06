/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac, randomBytes } from "crypto";
import { signUnsubscribeToken, verifyUnsubscribeToken, type UnsubKey } from "./unsubscribe";
import { signFeedbackToken, verifyFeedbackToken } from "@/lib/feedback/token";

/**
 * Links already sitting in inboxes carry these tokens, so their format is
 * spelled out here by hand: base64url of the JSON payload (no padding), a dot,
 * and base64url of HMAC-SHA256(secret, that payload text).
 */

// Generated per run: no key-shaped literal in the source.
const SECRET = randomBytes(32).toString("hex");
const NOW_S = 1_793_599_200;
// "?" and "~" spell "/" and "+" in plain base64, where base64url differs.
const USERS = ["6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", "??~~??~~"];
const KEYS: UnsubKey[] = ["all", "collabVotes", "weeklyDigest", "tripReminders"];

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function spell(payload: object): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${b64url(createHmac("sha256", SECRET).update(body).digest())}`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_S * 1000);
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", SECRET);
  vi.stubEnv("FEEDBACK_LINK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("signed email link tokens", () => {
  it("unsubscribe tokens keep their format, and ones spelled by hand verify", () => {
    const bodies: string[] = [];
    for (const u of USERS) {
      for (const k of KEYS) {
        const payload = { u, k, e: NOW_S + 365 * 86400 };
        const token = spell(payload);
        expect(signUnsubscribeToken(u, k)).toBe(token);
        expect(verifyUnsubscribeToken(token)).toMatchObject({ ok: true, payload });
        bodies.push(Buffer.from(JSON.stringify(payload)).toString("base64"));
      }
    }
    // The cases cover what tells base64url from plain base64.
    expect(bodies.some((b) => b.endsWith("="))).toBe(true);
    expect(bodies.some((b) => b.includes("+"))).toBe(true);
    expect(bodies.some((b) => b.includes("/"))).toBe(true);
  });

  it("feedback tokens keep their format, and ones spelled by hand verify", () => {
    for (const u of USERS) {
      const token = spell({ u, t: "fb", e: NOW_S + 30 * 86400 });
      expect(signFeedbackToken(u)).toBe(token);
      expect(verifyFeedbackToken(token)).toEqual({ ok: true, userId: u });
    }
  });

  it("a feedback token can name a trip, and only the secret's holder can change which", () => {
    const u = USERS[0];
    const payload = { u, t: "fb", e: NOW_S + 30 * 86400, r: "trip-1" };
    const token = spell(payload);
    expect(signFeedbackToken(u, 30, "trip-1")).toBe(token);
    expect(verifyFeedbackToken(token)).toEqual({ ok: true, userId: u, tripId: "trip-1" });

    const moved = b64url(Buffer.from(JSON.stringify({ ...payload, r: "trip-2" }), "utf8"));
    expect(verifyFeedbackToken(`${moved}.${token.split(".")[1]}`)).toEqual({ ok: false, reason: "signature" });
  });
});
