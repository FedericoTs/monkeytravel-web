/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import { signParticipantUnsubscribeToken, signUnsubscribeToken } from "@/lib/email/unsubscribe";

/**
 * A guest who said "I'm going" and gave an email gets the trip's daily plan,
 * and has no account to turn it off from. Their link's Confirm, or their mail
 * client's one-click POST, clears that address from the trip's rows: the
 * fan-out only mails rows with an email. Nothing else about them changes.
 */

const TRIP = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
const OTHER_TRIP = "0b5c3a52-6f0e-4c1e-9d3b-8a7f6e5d4c3b";
const ROW = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const USER = "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f6e";

type Row = { id: string; trip_id: string; email: string | null; left_at: string | null };
let rows: Row[] = [];
let failWrite = false;
let log: FakeQuery[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (q.table === "users" && q.op === "select") {
        return { data: { id: USER, notification_settings: { tripReminders: true } }, error: null };
      }
      if (q.table !== "trip_participants") return { data: null, error: null };
      if (q.op === "select" && q.end === "maybeSingle") {
        return { data: rows.find((r) => r.id === eqOf(q, "id")) ?? null, error: null };
      }
      if (q.op === "select") return { data: rows.filter((r) => r.trip_id === eqOf(q, "trip_id")), error: null };
      if (q.op === "update") {
        if (failWrite) return { data: null, error: { message: "connection reset" } };
        const ids = q.filters.find(([op, c]) => op === "in" && c === "id")?.[2] as string[];
        for (const r of rows) if (ids.includes(r.id)) Object.assign(r, q.value);
      }
      return { data: null, error: null };
    });
    log = fake.log;
    return fake.client;
  },
}));

const { GET, HEAD, POST } = await import("./route");

const url = (query = "") => `https://monkeytravel.app/api/unsubscribe${query}`;
const confirm = (token: string) =>
  POST(
    new NextRequest(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
  );
/** What Gmail or Yahoo send (RFC 8058), routed here by middleware.ts. */
const oneClick = (token: string) =>
  POST(
    new NextRequest(url(`?token=${encodeURIComponent(token)}`), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    })
  );
const emails = () => Object.fromEntries(rows.map((r) => [r.id, r.email]));
const writes = () => log.filter((q) => q.op === "update");

beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
  failWrite = false;
  log = [];
  rows = [
    { id: ROW, trip_id: TRIP, email: "guest@example.com", left_at: null },
    // The same person on another browser: the fan-out mails the address once.
    { id: "row-same-address", trip_id: TRIP, email: "Guest@Example.com", left_at: null },
    { id: "row-someone-else", trip_id: TRIP, email: "friend@example.com", left_at: null },
    { id: "row-other-trip", trip_id: OTHER_TRIP, email: "guest@example.com", left_at: null },
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a guest's link to a trip's daily plan", () => {
  it("Confirm stops it for that address on this trip, and only that", async () => {
    const res = await confirm(signParticipantUnsubscribeToken(ROW));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: true, guest: true });
    expect(emails()).toEqual({
      [ROW]: null,
      "row-same-address": null,
      "row-someone-else": "friend@example.com",
      "row-other-trip": "guest@example.com",
    });
    // "I'm going" stays: the one write clears the email and nothing else.
    expect(writes().map((q) => q.value)).toEqual([{ email: null }]);
    expect(rows.every((r) => r.left_at === null)).toBe(true);
  });

  it("a mail client's one-click POST does the same, with the token in the URL", async () => {
    const res = await oneClick(signParticipantUnsubscribeToken(ROW));
    expect(res.status).toBe(200);
    expect(emails()[ROW]).toBeNull();
    expect(emails()["row-same-address"]).toBeNull();
  });

  it("twice is fine: the second time there is nothing left to clear", async () => {
    const token = signParticipantUnsubscribeToken(ROW);
    await confirm(token);
    const again = await oneClick(token);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, applied: false, guest: true });
    expect(writes()).toEqual([]);
  });

  it("GET only looks; ?confirm=1 applies, for clients that cannot POST", async () => {
    const token = signParticipantUnsubscribeToken(ROW);
    const look = await GET(new NextRequest(url(`?token=${encodeURIComponent(token)}`)));
    expect(look.status).toBe(200);
    expect(look.headers.get("cache-control")).toContain("no-store");
    expect(emails()[ROW]).toBe("guest@example.com");
    expect((await HEAD(new NextRequest(url(`?token=${encodeURIComponent(token)}`)))).status).toBe(200);

    const applied = await GET(new NextRequest(url(`?token=${encodeURIComponent(token)}&confirm=1`)));
    expect(await applied.json()).toEqual({ ok: true, applied: true, guest: true });
    expect(emails()[ROW]).toBeNull();
  });

  it("an expired link says so and changes nothing", async () => {
    const res = await confirm(signParticipantUnsubscribeToken(ROW, -1));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("expired");
    expect(log).toEqual([]);
    expect(emails()[ROW]).toBe("guest@example.com");
  });

  it("a forged link changes nothing", async () => {
    const token = signParticipantUnsubscribeToken(ROW);
    const forged = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect((await oneClick(forged)).status).toBe(400);
    expect((await HEAD(new NextRequest(url(`?token=${encodeURIComponent(forged)}`)))).status).toBe(400);
    expect(log).toEqual([]);
  });

  it("a failed write is an error, not a quiet success", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failWrite = true;
    const res = await confirm(signParticipantUnsubscribeToken(ROW));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("connection reset");
  });
});

describe("an account's link", () => {
  it("still turns the setting off, through the page or one click", async () => {
    const token = signUnsubscribeToken(USER, "tripReminders");
    for (const send of [confirm, oneClick]) {
      const res = await send(token);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, applied: true, key: "tripReminders" });
      const [write] = writes();
      expect(write.table).toBe("users");
      expect(eqOf(write, "id")).toBe(USER);
      expect(write.value).toMatchObject({
        notification_settings: { tripReminders: false, marketingNotifications: false },
      });
    }
    expect(emails()[ROW]).toBe("guest@example.com");
  });
});
