/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase } from "@/tests/fake-supabase";
import { expensesSnapshot } from "./snapshot";

/**
 * "Mine" drives the remove control, so it follows the same rule as the
 * remove route: written by your account, or on this browser before you
 * signed in.
 */

const row = (id: string, createdBy: string | null, createdByCookie: string | null) => ({
  id,
  activity_id: null,
  amount: 10,
  currency: "EUR",
  category: "food",
  description: null,
  paid_by_user_id: createdBy,
  paid_by_cookie_id: createdByCookie,
  paid_by_name: null,
  created_by: createdBy,
  created_by_cookie_id: createdByCookie,
  created_at: "2026-10-01T12:00:00Z",
});

const admin = fakeSupabase((q) => {
  if (q.table === "trip_expenses") {
    return {
      data: [row("by-account", "mate-1", null), row("on-this-browser", null, "browser-cookie-1"), row("someone-else", "other-1", null)],
      error: null,
    };
  }
  return { data: [], error: null };
}).client as unknown as SupabaseClient;

describe("expensesSnapshot", () => {
  it("marks yours by account and by this browser, and nobody else's", async () => {
    const { expenses } = await expensesSnapshot(admin, "trip-1", "owner-1", "mate-1", "browser-cookie-1");
    expect(Object.fromEntries(expenses.map((e) => [e.id, e.mine]))).toEqual({
      "by-account": true,
      "on-this-browser": true,
      "someone-else": false,
    });
  });

  it("marks a guest's own by their browser only", async () => {
    const { expenses } = await expensesSnapshot(admin, "trip-1", "owner-1", null, "browser-cookie-1");
    expect(expenses.filter((e) => e.mine).map((e) => e.id)).toEqual(["on-this-browser"]);
  });

  // Anyone with the share link reads this, and a guest's cookie is who they are on every trip.
  it("sends names and amounts, never a guest's cookie or an account id", async () => {
    const world = fakeSupabase((q) => {
      if (q.table === "trip_expenses") return { data: [{ ...row("gelato", null, "guest-cookie-1"), amount: 20 }], error: null };
      if (q.table === "trip_expense_splits") {
        return {
          data: [
            { expense_id: "gelato", user_id: "owner-1", participant_cookie_id: null, participant_name: null, share_amount: 10 },
            { expense_id: "gelato", user_id: null, participant_cookie_id: "guest-cookie-1", participant_name: "Bo", share_amount: 10 },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    }).client as unknown as SupabaseClient;

    const snapshot = await expensesSnapshot(world, "trip-1", "owner-1", null, "guest-cookie-1");
    const sent = JSON.stringify(snapshot);
    expect(sent).not.toContain("guest-cookie-1");
    expect(sent).not.toContain("owner-1");
    expect(snapshot.expenses[0].splits).toEqual([
      { name: null, shareCents: 1000 },
      { name: "Bo", shareCents: 1000 },
    ]);
    // The server still knows whose share is whose.
    expect(snapshot.summary).toMatchObject({ youPaidCents: 2000, youOweCents: 1000, netCents: 1000 });
  });
});
