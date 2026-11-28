/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import { signParticipantUnsubscribeToken, signPlanReminderUnsubscribeToken } from "@/lib/email/unsubscribe";

/**
 * A planner with no account who ticked "remind me before the trip" stops the
 * reminders from any of them: their link's Confirm, or their mail client's
 * one-click POST, deletes the address with everything kept with it. Looking
 * at the link changes nothing.
 */

const ROW = "2c9e7a41-5b3d-4f8e-9a1c-6d4b2e8f0a73";
const OTHER_ROW = "8e1f4d2a-3c6b-4a9e-b7d5-0f2c9a6e1b48";

let reminders: string[] = [];
let failDelete = false;
let log: FakeQuery[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (q.table !== "plan_reminders" || q.op !== "delete") return { data: null, error: null };
      if (failDelete) return { data: null, error: { message: "connection reset" } };
      const id = eqOf(q, "id");
      const gone = reminders.filter((r) => r === id);
      reminders = reminders.filter((r) => r !== id);
      return { data: gone.map((r) => ({ id: r })), error: null };
    });
    log = fake.log;
    return fake.client;
  },
}));

const { GET, POST } = await import("./route");

const url = (query = "") => `https://monkeytravel.app/api/unsubscribe${query}`;
const confirm = (token: string) =>
  POST(
    new NextRequest(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
  );
const oneClick = (token: string) =>
  POST(
    new NextRequest(url(`?token=${encodeURIComponent(token)}`), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    })
  );

beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
  failDelete = false;
  log = [];
  reminders = [ROW, OTHER_ROW];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a reminder's link", () => {
  it("Confirm deletes that address's reminders, and only those", async () => {
    const res = await confirm(signPlanReminderUnsubscribeToken(ROW));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: true, reminder: true });
    expect(reminders).toEqual([OTHER_ROW]);
    expect(log.map((q) => [q.table, q.op])).toEqual([["plan_reminders", "delete"]]);
  });

  it("a mail client's one-click POST does the same, and twice is fine", async () => {
    const token = signPlanReminderUnsubscribeToken(ROW);
    expect((await oneClick(token)).status).toBe(200);
    expect(reminders).toEqual([OTHER_ROW]);
    const again = await oneClick(token);
    expect(await again.json()).toEqual({ ok: true, applied: false, reminder: true });
  });

  it("GET only looks", async () => {
    const look = await GET(new NextRequest(url(`?token=${encodeURIComponent(signPlanReminderUnsubscribeToken(ROW))}`)));
    expect(look.status).toBe(200);
    expect(await look.json()).toEqual({ ok: true, applied: false, reminder: true });
    expect(log).toEqual([]);
    expect(reminders).toEqual([ROW, OTHER_ROW]);
  });

  it("an expired link says so and deletes nothing", async () => {
    const res = await confirm(signPlanReminderUnsubscribeToken(ROW, -1));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("expired");
    expect(log).toEqual([]);
  });

  it("a guest's link never deletes a reminder", async () => {
    await confirm(signParticipantUnsubscribeToken(ROW));
    expect(log.some((q) => q.table === "plan_reminders")).toBe(false);
    expect(reminders).toEqual([ROW, OTHER_ROW]);
  });

  it("says so when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failDelete = true;
    expect((await confirm(signPlanReminderUnsubscribeToken(ROW))).status).toBe(500);
  });
});
