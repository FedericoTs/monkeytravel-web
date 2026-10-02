/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Settle Up settles people, guests included: a guest shows by the name they
 * joined with, under a label rather than their browser cookie, and with no
 * payment handles to look up.
 */

let userId = "owner-1";
let failing: string | null = null;

const expense = (id: string, paidBy: { user?: string; cookie?: string; name?: string }, amount: number) => ({
  id,
  activity_id: null,
  amount,
  currency: "EUR",
  category: "food",
  description: null,
  paid_by_user_id: paidBy.user ?? null,
  paid_by_cookie_id: paidBy.cookie ?? null,
  paid_by_name: paidBy.name ?? null,
  created_by: paidBy.user ?? null,
  created_by_cookie_id: paidBy.cookie ?? null,
  created_at: "2026-10-02T12:00:00Z",
});
const share = (expenseId: string, who: { user?: string; cookie?: string; name?: string }, amount: number) => ({
  expense_id: expenseId,
  user_id: who.user ?? null,
  participant_cookie_id: who.cookie ?? null,
  participant_name: who.name ?? null,
  share_amount: amount,
});

// Bo (a guest) paid 40 for Bo and the mate; the owner paid 40 for the owner and the mate.
const admin = fakeSupabase((q) => {
  if (failing === q.table) return { data: null, error: { message: "boom" } };
  if (q.table === "trip_expenses") {
    return { data: [expense("gelato", { cookie: "bo-cookie", name: "Bo" }, 40), expense("dinner", { user: "owner-1" }, 40)], error: null };
  }
  if (q.table === "trip_expense_splits") {
    return {
      data: [
        share("gelato", { cookie: "bo-cookie", name: "Bo" }, 20),
        share("gelato", { user: "mate-1" }, 20),
        share("dinner", { user: "owner-1" }, 20),
        share("dinner", { user: "mate-1" }, 20),
      ],
      error: null,
    };
  }
  if (q.table === "public_profiles") {
    return {
      data: [
        { id: "owner-1", display_name: "Olive" },
        { id: "mate-1", display_name: "mate@example.com" },
      ],
      error: null,
    };
  }
  if (q.table === "users") return { data: [{ id: "owner-1", paypal_handle: "olive", venmo_handle: null, wise_handle: null }], error: null };
  return { data: null, error: null };
});

const member = fakeSupabase((q) => {
  if (q.table === "trips") return { data: { id: "trip-1", user_id: "owner-1", title: "Lisbon" }, error: null };
  return { data: null, error: null };
});

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: userId }, supabase: member.client, errorResponse: null }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

const { GET } = await import("./route");
const call = () => GET(new NextRequest("http://localhost/api/trips/trip-1/settlements"), { params: Promise.resolve({ id: "trip-1" }) });

beforeEach(() => {
  userId = "owner-1";
  failing = null;
  admin.log.length = 0;
});

describe("GET /api/trips/[id]/settlements", () => {
  it("settles a guest by name, without their cookie", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transfers).toEqual([
      {
        fromUser: { id: "mate-1", name: "—" },
        toUser: { id: "guest-1", name: "Bo", guest: true, paypal_handle: null, venmo_handle: null, wise_handle: null },
        amount: 20,
        currency: "EUR",
      },
      {
        fromUser: { id: "mate-1", name: "—" },
        toUser: { id: "owner-1", name: "Olive", guest: false, paypal_handle: "olive", venmo_handle: null, wise_handle: null },
        amount: 20,
        currency: "EUR",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("bo-cookie");
    // Handles are looked up for account recipients only.
    const handles = admin.log.find((q: FakeQuery) => q.table === "users");
    expect(handles?.filters).toEqual([["in", "id", ["owner-1"]]]);
  });

  it("fails rather than look settled when the shares can't be read", async () => {
    failing = "trip_expense_splits";
    const res = await call();
    expect(res.status).toBe(500);
  });

  it("is for the trip's members", async () => {
    userId = "stranger-1";
    const res = await call();
    expect(res.status).toBe(403);
    expect(admin.log).toEqual([]);
  });
});
