/** @vitest-environment node */
/**
 * The post-trip follow-ups go only to people who came back after making the
 * trip. The case that prompted it: an owner who signed in once, the day they
 * made the trip, never opened a trip email and was still due more of them.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cameBack, cameBackFrom, loadEngagement, type EngagementSignals } from "./followup-engagement";

const MADE = "2026-08-26T10:30:00.000Z";
const FROM = "2026-08-27T10:30:00.000Z";
const NONE: EngagementSignals = { openedEmail: false, usedApp: false, lastSignInAt: null };

describe("cameBackFrom", () => {
  it("starts a day after the trip was made", () => {
    expect(cameBackFrom(MADE)).toBe(FROM);
  });

  it("is null for a missing or unreadable date", () => {
    expect(cameBackFrom(null)).toBeNull();
    expect(cameBackFrom("not a date")).toBeNull();
  });
});

describe("cameBack", () => {
  it("counts an opened email or using the app signed in", () => {
    expect(cameBack(FROM, { ...NONE, openedEmail: true })).toBe(true);
    expect(cameBack(FROM, { ...NONE, usedApp: true })).toBe(true);
  });

  it("counts a sign-in from a day after the trip on", () => {
    expect(cameBack(FROM, { ...NONE, lastSignInAt: "2026-09-02T08:00:00Z" })).toBe(true);
  });

  it("does not count the sign-in that made the trip", () => {
    expect(cameBack(FROM, { ...NONE, lastSignInAt: "2026-08-26T10:22:53Z" })).toBe(false);
  });

  it("does not count someone who never came back", () => {
    expect(cameBack(FROM, NONE)).toBe(false);
  });
});

describe("loadEngagement", () => {
  type Result = { data: unknown; error: unknown };
  const fake = (tables: Record<string, Result>, auth: Result) => {
    const calls: string[] = [];
    const svc = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: (col: string, value: string) => (calls.push(`${table}.${col}=${value}`), chain),
          gte: (col: string, value: string) => (calls.push(`${table}.${col}>=${value}`), chain),
          limit: () => Promise.resolve(tables[table]),
        };
        return chain;
      },
      auth: { admin: { getUserById: async () => auth } },
    };
    return { svc: svc as unknown as SupabaseClient, calls };
  };
  const empty = { email_log: { data: [], error: null }, page_views: { data: [], error: null } };

  it("reads opens and visits from the cut-off on, and the last sign-in", async () => {
    const { svc, calls } = fake(
      { email_log: { data: [{ id: "e" }], error: null }, page_views: { data: [], error: null } },
      { data: { user: { last_sign_in_at: MADE } }, error: null }
    );
    expect(await loadEngagement(svc, "u1", "a@example.com", FROM)).toEqual({
      openedEmail: true,
      usedApp: false,
      lastSignInAt: MADE,
    });
    expect(calls).toContain(`email_log.opened_at>=${FROM}`);
    expect(calls).toContain(`page_views.created_at>=${FROM}`);
    expect(calls).toContain("page_views.user_id=u1");
  });

  it("treats an account missing from auth as never signed in", async () => {
    const { svc } = fake(empty, { data: { user: null }, error: { status: 404, message: "User not found" } });
    expect(await loadEngagement(svc, "u1", "a@example.com", FROM)).toEqual(NONE);
  });

  it("throws on a read error, so the cron fails closed", async () => {
    const { svc } = fake(
      { ...empty, page_views: { data: null, error: { message: "timeout" } } },
      { data: { user: null }, error: null }
    );
    await expect(loadEngagement(svc, "u1", "a@example.com", FROM)).rejects.toMatchObject({ message: "timeout" });
  });
});
