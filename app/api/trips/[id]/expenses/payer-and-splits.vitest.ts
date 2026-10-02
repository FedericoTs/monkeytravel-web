import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A member's expense records who paid and splits equally across the trip's
 * members. Without either, compute_trip_settlements skipped it, so Settle Up
 * never counted what members added in the ledger.
 */

type Row = Record<string, unknown>;
const log: { table: string; op: string; value?: unknown; filter?: [string, unknown][] }[] = [];
let displayName: string | null = "Sam";
let existingSplits: Row[] = [];

function chainFor(table: string) {
  const filters: [string, unknown][] = [];
  let op = "select";
  let value: unknown;
  const result = () => {
    if (table === "users") return { data: { display_name: displayName }, error: null };
    if (table === "trips") return { data: { user_id: "owner-1" }, error: null };
    if (table === "trip_collaborators") return { data: [{ user_id: "mate-1" }, { user_id: "voter-1" }], error: null };
    if (table === "trip_expenses") return { data: { id: "exp-1", ...(value as Row) }, error: null };
    if (table === "trip_expense_splits" && op === "select") return { data: existingSplits, error: null };
    return { data: null, error: null };
  };
  const record = () => log.push({ table, op, value, filter: [...filters] });
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (v: unknown) => ((op = "insert"), (value = v), chain),
    update: (v: unknown) => ((op = "update"), (value = v), chain),
    eq: (k: string, v: unknown) => (filters.push([k, v]), chain),
    order: () => chain,
    single: async () => (record(), result()),
    maybeSingle: async () => (record(), result()),
    then: (resolve: (r: unknown) => unknown) => (record(), resolve(result())),
  };
  return chain;
}

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: "mate-1", email: "mate@example.com" },
    errorResponse: null,
    supabase: { from: (table: string) => chainFor(table) },
  }),
}));

const { POST, PATCH } = await import("./route");
const ctx = { params: Promise.resolve({ id: "trip-1" }) };
const req = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/trips/trip-1/expenses", { method, body: JSON.stringify(body) });
const ops = (table: string, op: string) => log.filter((l) => l.table === table && l.op === op);

beforeEach(() => {
  log.length = 0;
  displayName = "Sam";
  existingSplits = [];
});

describe("POST /api/trips/[id]/expenses", () => {
  it("records the member as payer and splits across owner and collaborators", async () => {
    const res = await POST(req("POST", { amount: 100, currency: "EUR", category: "food" }), ctx);
    expect(res.status).toBe(200);
    expect(ops("trip_expenses", "insert")[0].value).toMatchObject({
      created_by: "mate-1",
      paid_by_user_id: "mate-1",
      paid_by_name: "Sam",
      created_by_name: "Sam",
    });
    const splits = ops("trip_expense_splits", "insert")[0].value as Row[];
    expect(splits.map((s) => s.user_id)).toEqual(["owner-1", "mate-1", "voter-1"]);
    expect(splits.map((s) => s.share_amount)).toEqual([33.34, 33.33, 33.33]);
    expect(splits.every((s) => s.expense_id === "exp-1")).toBe(true);
  });

  it("never shows an email-like name as the payer", async () => {
    displayName = "mate@example.com";
    await POST(req("POST", { amount: 10, currency: "EUR", category: "food" }), ctx);
    expect(ops("trip_expenses", "insert")[0].value).toMatchObject({ paid_by_name: null, created_by_name: null });
  });
});

describe("PATCH /api/trips/[id]/expenses", () => {
  it("re-divides the existing shares when the amount changes", async () => {
    existingSplits = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    await PATCH(req("PATCH", { id: "exp-1", amount: 90 }), ctx);
    const updates = ops("trip_expense_splits", "update");
    expect(updates.map((u) => [u.filter?.[0]?.[1], (u.value as Row).share_amount])).toEqual([
      ["s1", 30],
      ["s2", 30],
      ["s3", 30],
    ]);
    expect(ops("trip_expense_splits", "insert")).toEqual([]);
  });

  it("adds member shares to an older expense that has none", async () => {
    await PATCH(req("PATCH", { id: "exp-1", amount: 60 }), ctx);
    const splits = ops("trip_expense_splits", "insert")[0].value as Row[];
    expect(splits.map((s) => [s.user_id, s.share_amount])).toEqual([
      ["owner-1", 20],
      ["mate-1", 20],
      ["voter-1", 20],
    ]);
  });

  it("leaves the shares alone when the amount doesn't change", async () => {
    existingSplits = [{ id: "s1" }];
    await PATCH(req("PATCH", { id: "exp-1", description: "Tram tickets" }), ctx);
    expect(ops("trip_expense_splits", "update")).toEqual([]);
    expect(ops("trip_expense_splits", "insert")).toEqual([]);
  });
});
