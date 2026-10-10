import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A member's expense records who paid and splits equally across the trip's
 * group (lib/trips/roster). Without either, Settle Up never counted what
 * members added in the ledger.
 */

type Row = Record<string, unknown>;
const log: { table: string; op: string; value?: unknown; filter?: [string, unknown][] }[] = [];
let displayName: string | null = "Sam";
let existingSplits: Row[] = [];
let participants: Row[] = [];
const collaborators = [
  { user_id: "mate-1", role: "editor" },
  { user_id: "voter-1", role: "voter" },
  { user_id: "viewer-1", role: "viewer" },
];
/** "table:op" that answers with an error. */
let failing: string | null = null;
const previous = { amount: 120, currency: "EUR", category: "food", description: "Dinner", spent_on: "2026-10-01" };

function chainFor(table: string) {
  const filters: [string, unknown][] = [];
  let op = "select";
  let value: unknown;
  const result = () => {
    if (failing === `${table}:${op}`) return { data: null, error: { message: "boom" } };
    if (table === "users") return { data: { display_name: displayName }, error: null };
    if (table === "trips") return { data: { user_id: "owner-1" }, error: null };
    if (table === "trip_collaborators") return { data: collaborators, error: null };
    if (table === "trip_participants") return { data: participants, error: null };
    if (table === "trip_expenses" && op === "select") return { data: previous, error: null };
    if (table === "trip_expenses") return { data: { id: "exp-1", ...(value as Row) }, error: null };
    if (table === "trip_expense_splits" && op === "select") return { data: existingSplits, error: null };
    return { data: null, error: null };
  };
  const record = () => log.push({ table, op, value, filter: [...filters] });
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (v: unknown) => ((op = "insert"), (value = v), chain),
    update: (v: unknown) => ((op = "update"), (value = v), chain),
    upsert: (v: unknown) => ((op = "upsert"), (value = v), chain),
    delete: () => ((op = "delete"), chain),
    eq: (k: string, v: unknown) => (filters.push([k, v]), chain),
    is: () => chain,
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
// The roster reads the "I'm going" list with the service role.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => chainFor(table) }) }));

const { POST, PATCH } = await import("./route");
const ctx = { params: Promise.resolve({ id: "trip-1" }) };
const req = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/trips/trip-1/expenses", { method, body: JSON.stringify(body) });
const ops = (table: string, op: string) => log.filter((l) => l.table === table && l.op === op);

beforeEach(() => {
  log.length = 0;
  displayName = "Sam";
  existingSplits = [];
  participants = [];
  failing = null;
});

describe("POST /api/trips/[id]/expenses", () => {
  it("records the member as payer and splits across the owner, editors, voters and anyone going", async () => {
    participants = [{ participant_cookie_id: "guest-cookie-1", user_id: null, display_name: "Bo" }];
    const res = await POST(req("POST", { amount: 100, currency: "EUR", category: "food" }), ctx);
    expect(res.status).toBe(200);
    expect(ops("trip_expenses", "insert")[0].value).toMatchObject({
      created_by: "mate-1",
      paid_by_user_id: "mate-1",
      paid_by_name: "Sam",
      created_by_name: "Sam",
    });
    const splits = ops("trip_expense_splits", "insert")[0].value as Row[];
    // The viewer isn't charged; the guest who said they're going is.
    expect(splits.map((s) => [s.user_id, s.participant_cookie_id, s.share_amount])).toEqual([
      ["owner-1", null, 25],
      ["mate-1", null, 25],
      ["voter-1", null, 25],
      [null, "guest-cookie-1", 25],
    ]);
    expect(splits[3].participant_name).toBe("Bo");
    expect(splits.every((s) => s.expense_id === "exp-1")).toBe(true);
  });

  it("charges a viewer once they say they're going", async () => {
    participants = [{ participant_cookie_id: "viewer-cookie-1", user_id: "viewer-1", display_name: "Vi" }];
    await POST(req("POST", { amount: 100, currency: "EUR", category: "food" }), ctx);
    const splits = ops("trip_expense_splits", "insert")[0].value as Row[];
    expect(splits.map((s) => s.user_id)).toEqual(["owner-1", "mate-1", "voter-1", "viewer-1"]);
  });

  it("doesn't charge someone who said they're going only on the public trip page", async () => {
    participants = [
      { participant_cookie_id: "public-cookie-1", user_id: null, display_name: "Pat", source: "public" },
      { participant_cookie_id: "guest-cookie-1", user_id: null, display_name: "Bo", source: "shared" },
    ];
    await POST(req("POST", { amount: 100, currency: "EUR", category: "food" }), ctx);
    const splits = ops("trip_expense_splits", "insert")[0].value as Row[];
    expect(splits.map((s) => s.user_id ?? s.participant_cookie_id)).toEqual(["owner-1", "mate-1", "voter-1", "guest-cookie-1"]);
  });

  it("never shows an email-like name as the payer", async () => {
    displayName = "mate@example.com";
    await POST(req("POST", { amount: 10, currency: "EUR", category: "food" }), ctx);
    expect(ops("trip_expenses", "insert")[0].value).toMatchObject({ paid_by_name: null, created_by_name: null });
  });

  it("drops the expense when its shares can't be saved", async () => {
    failing = "trip_expense_splits:insert";
    const res = await POST(req("POST", { amount: 100, currency: "EUR", category: "food" }), ctx);
    expect(res.status).toBe(500);
    expect(ops("trip_expenses", "delete").map((d) => d.filter)).toEqual([[["id", "exp-1"]]]);
  });

  it("doesn't split across part of the group when the members can't be read", async () => {
    failing = "trip_collaborators:select";
    const res = await POST(req("POST", { amount: 100, currency: "EUR", category: "food" }), ctx);
    expect(res.status).toBe(500);
    expect(ops("trip_expense_splits", "insert")).toEqual([]);
    expect(ops("trip_expenses", "delete")).toHaveLength(1);
  });

  it("reads an amount sent as text like Today does, refusing one that could mean two things", async () => {
    // Number("1.200") is 1.2: this used to be saved a thousand times too small.
    const res = await POST(req("POST", { amount: "1.200", currency: "EUR", category: "food" }), ctx);
    expect(res.status).toBe(400);
    expect(ops("trip_expenses", "insert")).toEqual([]);

    await POST(req("POST", { amount: "1.200,50", currency: "EUR", category: "food" }), ctx);
    expect(ops("trip_expenses", "insert")[0].value).toMatchObject({ amount: 1200.5 });
  });
});

describe("PATCH /api/trips/[id]/expenses", () => {
  it("re-divides the existing shares when the amount changes", async () => {
    existingSplits = [
      { id: "s1", user_id: "owner-1", participant_cookie_id: null },
      { id: "s2", user_id: "mate-1", participant_cookie_id: null },
      { id: "s3", user_id: null, participant_cookie_id: "guest-cookie" },
    ];
    const res = await PATCH(req("PATCH", { id: "exp-1", amount: 90 }), ctx);
    expect(res.status).toBe(200);
    // One write for all the shares, so they can't end up half re-divided.
    const upserts = ops("trip_expense_splits", "upsert");
    expect(upserts).toHaveLength(1);
    const rows = upserts[0].value as Row[];
    expect(rows.map((s) => [s.id, s.share_amount])).toEqual([
      ["s1", 30],
      ["s2", 30],
      ["s3", 30],
    ]);
    // The table checks each proposed row has exactly one of the two
    // identities, before the conflict makes it an update.
    expect(rows.map((s) => [s.user_id, s.participant_cookie_id])).toEqual([
      ["owner-1", null],
      ["mate-1", null],
      [null, "guest-cookie"],
    ]);
    expect(ops("trip_expense_splits", "update")).toEqual([]);
    expect(ops("trip_expense_splits", "insert")).toEqual([]);
  });

  it("puts the edit back when the shares can't follow the new amount", async () => {
    existingSplits = [{ id: "s1" }, { id: "s2" }];
    failing = "trip_expense_splits:upsert";
    const res = await PATCH(req("PATCH", { id: "exp-1", amount: 90, description: "Tram tickets" }), ctx);
    expect(res.status).toBe(500);
    const updates = ops("trip_expenses", "update").map((u) => u.value);
    expect(updates).toEqual([
      { amount: 90, description: "Tram tickets" },
      { amount: 120, description: "Dinner" },
    ]);
  });

  it("doesn't add a second set of shares when the existing ones can't be read", async () => {
    failing = "trip_expense_splits:select";
    const res = await PATCH(req("PATCH", { id: "exp-1", amount: 90 }), ctx);
    expect(res.status).toBe(500);
    expect(ops("trip_expense_splits", "insert")).toEqual([]);
    expect(ops("trip_expenses", "update").map((u) => u.value)).toEqual([{ amount: 90 }, { amount: 120 }]);
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
