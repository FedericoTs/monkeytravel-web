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
});
