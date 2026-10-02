/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * A signed-in person who pays on Today is the payer by their account, so the
 * payment reads as theirs and they share in it once. Only members (owner and
 * collaborators) become the creator by account: a creator account can edit
 * the row through the table's policies.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
let signedIn: { id: string } | null = null;
let browserCookie: string | undefined;
let collaborators: string[] = [];
let participants: Array<{ participant_cookie_id: string; user_id: string | null; display_name: string }> = [];
let existingExpense: { created_by: string | null; created_by_cookie_id: string | null } | null = null;
let log: FakeQuery[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (browserCookie ? { value: browserCookie } : undefined), set: () => {} }),
}));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true }) }) }));
vi.mock("@/lib/participants/flag", () => ({ isLiveTripParticipantsEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: () => {} }));
vi.mock("@/lib/expenses/snapshot", () => ({ expensesSnapshot: async () => ({ expenses: [], summary: null }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (q.table === "trips") return { data: { id: "trip-1", user_id: "owner-1", trip_meta: {}, budget: { currency: "EUR" } }, error: null };
      if (q.table === "trip_collaborators") {
        const id = eqOf(q, "user_id") as string;
        return { data: collaborators.includes(id) ? { user_id: id } : null, error: null };
      }
      if (q.table === "users") return { data: { display_name: "Luca" }, error: null };
      if (q.table === "trip_participants") {
        if (q.end === "list") return { data: participants, error: null };
        const byUser = eqOf(q, "user_id");
        const byCookie = eqOf(q, "participant_cookie_id");
        const row = participants.find((p) => (byUser && p.user_id === byUser) || (byCookie && p.participant_cookie_id === byCookie));
        return { data: row ? { display_name: row.display_name } : null, error: null };
      }
      if (q.table === "trip_expenses" && q.op === "insert") return { data: { id: "exp-1" }, error: null };
      if (q.table === "trip_expenses" && q.op === "select") return { data: existingExpense, error: null };
      return { data: null, error: null };
    });
    log = fake.log;
    return fake.client;
  },
}));

const { POST } = await import("./route");
const send = (body: Record<string, unknown>) =>
  POST(
    new NextRequest(`http://localhost/api/shared/${TOKEN}/expense`, {
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  );
const ops = (table: string, op: FakeQuery["op"]) => log.filter((q) => q.table === table && q.op === op);

beforeEach(() => {
  signedIn = null;
  browserCookie = "browser-cookie-1";
  collaborators = [];
  participants = [];
  existingExpense = null;
});

describe("POST /api/shared/[token]/expense", () => {
  it("records a collaborator who pays by their account, sharing once", async () => {
    signedIn = { id: "mate-1" };
    collaborators = ["mate-1"];
    participants = [
      { participant_cookie_id: "mate-old-cookie", user_id: "mate-1", display_name: "Luca" },
      { participant_cookie_id: "guest-cookie-1", user_id: null, display_name: "Bo" },
    ];
    const res = await send({ amount: "30" });
    expect(res.status).toBe(200);
    expect(ops("trip_expenses", "insert")[0].value).toMatchObject({
      created_by: "mate-1",
      created_by_cookie_id: null,
      paid_by_user_id: "mate-1",
      paid_by_cookie_id: null,
      paid_by_name: "Luca",
    });
    const splits = ops("trip_expense_splits", "insert")[0].value as Array<Record<string, unknown>>;
    expect(splits.map((s) => [s.user_id, s.participant_cookie_id, s.share_amount])).toEqual([
      ["owner-1", null, 10],
      ["mate-1", null, 10],
      [null, "guest-cookie-1", 10],
    ]);
  });

  it("records a signed-in visitor who pays by account, but keeps this browser as the creator", async () => {
    signedIn = { id: "user-9" };
    browserCookie = "visitor-cookie-1";
    await send({ amount: "12" });
    expect(ops("trip_expenses", "insert")[0].value).toMatchObject({
      created_by: null,
      created_by_cookie_id: "visitor-cookie-1",
      paid_by_user_id: "user-9",
      paid_by_cookie_id: null,
    });
  });

  it("records a guest who pays by their browser", async () => {
    browserCookie = "guest-cookie-1";
    await send({ amount: "12" });
    expect(ops("trip_expenses", "insert")[0].value).toMatchObject({
      created_by: null,
      created_by_cookie_id: "guest-cookie-1",
      paid_by_user_id: null,
      paid_by_cookie_id: "guest-cookie-1",
    });
  });

  it("removes your expense from another device of the same account", async () => {
    signedIn = { id: "mate-1" };
    browserCookie = "second-browser-1";
    existingExpense = { created_by: "mate-1", created_by_cookie_id: null };
    const expenseId = "33333333-4444-4555-8666-777777777777";
    await send({ undo: true, expense_id: expenseId });
    const [removed] = ops("trip_expenses", "delete");
    expect(eqOf(removed, "id")).toBe(expenseId);
    // Not limited to this browser's cookie, which wrote nothing here.
    expect(eqOf(removed, "created_by_cookie_id")).toBeUndefined();
  });

  it("leaves someone else's expense alone", async () => {
    signedIn = { id: "mate-1" };
    existingExpense = { created_by: "other-1", created_by_cookie_id: null };
    const res = await send({ undo: true, expense_id: "33333333-4444-4555-8666-777777777777" });
    expect(res.status).toBe(200);
    expect(ops("trip_expenses", "delete")).toEqual([]);
  });
});
