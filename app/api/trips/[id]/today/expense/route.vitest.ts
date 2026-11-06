// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The owner and collaborators log who paid for something on a live trip, split
 * across the group. Money is split to the cent, nothing half-saved may stay, and the
 * answer carries names and amounts, never anyone's account or browser id. The real
 * route, auth helpers, limiter, expense code and snapshot run over small faked tables.
 */

const OWNER = { id: "owner-1", email: "owner@mail.example.com" };
const MATE = { id: "mate-1", email: "mate@mail.example.com" };
const STRANGER = { id: "person-1", email: "person@mail.example.com" };
const GUEST_COOKIE = "guest-cookie-0001";
const OTHER_GUEST_COOKIE = "guest-cookie-0002";
const EXPENSE_ID = "11111111-2222-4333-8444-555555555555";
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };
const REFUSED = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
const FAILED = { message: "write failed" };

type Row = Record<string, unknown>;

const s = vi.hoisted(() => ({
  signedIn: null as { id: string; email: string } | null,
  tripId: "",
  budget: null as unknown,
  tripRead: null as { data: unknown; error: unknown } | null,
  cookie: undefined as string | undefined,
  collaborators: [] as Array<{ user_id: string; role: string }>,
  membershipRead: null as { data: unknown; error: unknown } | null,
  rosterError: null as unknown,
  expenses: [] as Array<Record<string, unknown>>,
  splits: [] as Array<Record<string, unknown>>,
  undoRead: null as { data: unknown; error: unknown } | null,
  ledgerRead: null as { data: unknown; error: unknown } | null,
  insertError: null as unknown,
  splitError: null as unknown,
  deleteError: null as unknown,
  pings: [] as string[],
  events: [] as string[],
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => void task(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (s.cookie ? { value: s.cookie } : undefined) }),
}));
vi.mock("@/lib/posthog/server", () => ({
  captureServerEvent: (_who: string, name: string) => void s.events.push(name),
}));
// The limiter is real, on its in-memory store: nothing here reaches Redis.
vi.mock("@upstash/redis", () => ({
  Redis: class {
    eval = async () => {
      throw new Error("no Redis in tests");
    };
  },
}));

/** The signed-in person's own client: what the access check reads. */
const session = fakeSupabase((q: FakeQuery) => {
  if (q.table === "trips") {
    if (s.tripRead) return s.tripRead;
    return eqOf(q, "id") === s.tripId ? { data: { id: s.tripId, user_id: OWNER.id, budget: s.budget }, error: null } : NO_ROW;
  }
  if (q.table === "trip_collaborators") {
    const mate = s.collaborators.find((c) => c.user_id === eqOf(q, "user_id"));
    return mate ? { data: mate, error: null } : NO_ROW;
  }
  return NO_ROW;
});

/** The service-role client, over small tables, so what's answered is what was written. */
const service = fakeSupabase((q: FakeQuery) => {
  switch (q.table) {
    case "trip_collaborators":
      if (q.end === "list") return s.rosterError ? { data: null, error: s.rosterError } : { data: s.collaborators, error: null };
      return s.membershipRead ?? { data: s.collaborators.find((c) => c.user_id === eqOf(q, "user_id")) ?? null, error: null };
    case "trip_participants":
      return { data: q.end === "list" ? [] : null, error: null };
    case "users":
      return { data: { display_name: eqOf(q, "id") === OWNER.id ? "Olivia" : "Marco" }, error: null };
    case "trip_expenses":
      return expensesTable(q);
    case "trip_expense_splits":
      if (q.op !== "insert") return { data: s.splits, error: null };
      if (s.splitError) return { data: null, error: s.splitError };
      s.splits.push(...(q.value as Row[]));
      return { data: null, error: null };
    default:
      return { data: null, error: null };
  }
});
function expensesTable(q: FakeQuery) {
  if (q.op === "insert") {
    if (s.insertError) return { data: null, error: s.insertError };
    s.expenses.push({ id: EXPENSE_ID, created_at: "2027-05-10T12:00:00Z", ...(q.value as Row) });
    return { data: { id: EXPENSE_ID }, error: null };
  }
  if (q.op === "delete") {
    if (s.deleteError) return { data: null, error: s.deleteError };
    s.expenses = s.expenses.filter((e) => e.id !== eqOf(q, "id"));
    return { data: null, error: null };
  }
  if (q.end === "maybeSingle") {
    if (s.undoRead) return s.undoRead;
    return { data: s.expenses.find((e) => e.id === eqOf(q, "id") && e.trip_id === eqOf(q, "trip_id")) ?? null, error: null };
  }
  return s.ledgerRead ?? { data: s.expenses.filter((e) => e.trip_id === eqOf(q, "trip_id")), error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...session.client, auth: { getUser: async () => ({ data: { user: s.signedIn }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    ...service.client,
    channel: (topic: string) => ({
      httpSend: async () => void s.pings.push(topic),
    }),
  }),
}));

const { POST } = await import("./route");

const send = (body: unknown) =>
  POST(
    new NextRequest(`https://monkeytravel.app/api/trips/${s.tripId}/today/expense`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: s.tripId }) }
  );
const writes = () => service.log.filter((q) => q.op !== "select");
const inserted = (table: string) => service.log.filter((q) => q.table === table && q.op === "insert").map((q) => q.value);
const deleted = () => service.log.filter((q) => q.op === "delete");
/** One payment already in the ledger, logged by the trip's collaborator unless said otherwise. */
const existingPayment = (by: Partial<Row> = {}) => {
  s.expenses = [
    {
      id: EXPENSE_ID,
      trip_id: s.tripId,
      amount: 30,
      currency: "EUR",
      category: "food",
      created_at: "2027-05-09T12:00:00Z",
      created_by: MATE.id,
      created_by_cookie_id: null,
      paid_by_user_id: MATE.id,
      paid_by_cookie_id: null,
      paid_by_name: "Marco",
      ...by,
    },
  ];
};

let tests = 0;
beforeEach(() => {
  s.signedIn = OWNER;
  // The limiter counts per person and trip, so each test has its own trip.
  s.tripId = `trip-${++tests}`;
  s.budget = null;
  s.tripRead = null;
  s.cookie = undefined;
  s.collaborators = [{ user_id: MATE.id, role: "editor" }];
  s.membershipRead = null;
  s.rosterError = null;
  s.expenses = [];
  s.splits = [];
  s.undoRead = null;
  s.ledgerRead = null;
  s.insertError = null;
  s.splitError = null;
  s.deleteError = null;
  s.pings = [];
  s.events = [];
  session.log.length = 0;
  service.log.length = 0;
  vi.stubEnv("NEXT_PUBLIC_LIVE_TRIP_PARTICIPANTS", "on");
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who may log a payment", () => {
  it("answers 404 to everyone while the feature is switched off, reading nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_LIVE_TRIP_PARTICIPANTS", "off");
    expect((await send({ amount: "30" })).status).toBe(404);
    expect(session.log).toEqual([]);
    expect(service.log).toEqual([]);
  });

  it("refuses someone signed out, reading no trip", async () => {
    s.signedIn = null;
    expect((await send({ amount: "30" })).status).toBe(401);
    expect(session.log).toEqual([]);
    expect(service.log).toEqual([]);
  });

  it("refuses an outsider, a missing trip and a refused read, each before the service role is used", async () => {
    s.signedIn = STRANGER;
    expect((await send({ amount: "30" })).status).toBe(403);
    s.tripRead = NO_ROW;
    expect((await send({ amount: "30" })).status).toBe(404);
    s.tripRead = REFUSED;
    expect((await send({ amount: "30" })).status).toBe(500);
    expect(service.log).toEqual([]);
  });

  it("stops the sixteenth change in a minute, before reading the trip", async () => {
    for (let i = 0; i < 15; i++) expect((await send({ amount: "not a number" })).status).toBe(400);
    session.log.length = 0;

    const res = await send({ amount: "30" });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMIT");
    expect(session.log).toEqual([]);
    expect(writes()).toEqual([]);
  });
});

describe("logging a payment", () => {
  it("writes it as the signed-in person's, whatever the body claims, in shares that add up to the cent", async () => {
    s.collaborators.push({ user_id: "mate-2", role: "voter" });
    s.budget = { currency: "JPY" };
    const res = await send({
      amount: "10",
      category: "food",
      description: "  Gelato  ",
      activity_id: "activity-1",
      paid_by_user_id: "someone-else",
      created_by: "someone-else",
      trip_id: "another-trip",
    });
    expect(res.status).toBe(200);

    expect(inserted("trip_expenses")).toEqual([
      {
        trip_id: s.tripId,
        amount: 10,
        currency: "JPY",
        category: "food",
        description: "Gelato",
        activity_id: "activity-1",
        created_by: OWNER.id,
        created_by_cookie_id: null,
        created_by_name: "Olivia",
        paid_by_user_id: OWNER.id,
        paid_by_cookie_id: null,
        paid_by_name: "Olivia",
      },
    ]);
    const split = (user_id: string, share_amount: number) => ({
      expense_id: EXPENSE_ID,
      user_id,
      participant_cookie_id: null,
      participant_name: null,
      share_amount,
    });
    expect(inserted("trip_expense_splits")).toEqual([[split(OWNER.id, 3.34), split(MATE.id, 3.33), split("mate-2", 3.33)]]);
    // Everyone's open Today hears about it, and the event is counted.
    expect(s.pings).toEqual([`trip-today:${s.tripId}`]);
    expect(s.events).toEqual(["trip_expense_added"]);
  });

  it("answers the ledger with names and amounts, and nobody's account or browser id", async () => {
    existingPayment({
      id: "22222222-2222-4333-8444-555555555555",
      created_by: null,
      created_by_cookie_id: OTHER_GUEST_COOKIE,
      paid_by_user_id: null,
      paid_by_cookie_id: OTHER_GUEST_COOKIE,
    });
    s.signedIn = MATE;
    s.cookie = GUEST_COOKIE;

    const res = await send({ amount: "20" });
    expect(res.status).toBe(200);
    const body = await res.text();
    const ledger = JSON.parse(body);
    expect(ledger.expenses).toHaveLength(2);
    expect(ledger.summary).toMatchObject({ currency: "EUR", count: 2, youPaidCents: 2000 });
    for (const secret of [OWNER.id, MATE.id, GUEST_COOKIE, OTHER_GUEST_COOKIE]) expect(body).not.toContain(secret);
  });

  it("refuses a body or an amount it can't read, writing nothing and telling nobody", async () => {
    const unreadable: unknown[] = [
      "{not json",
      "42",
      {},
      { amount: 0 },
      { amount: -5 },
      { amount: "lots" },
      { amount: 1_000_000.01 },
    ];
    for (const body of unreadable) expect((await send(body)).status, JSON.stringify(body)).toBe(400);
    expect(writes()).toEqual([]);
    expect(s.pings).toEqual([]);
  });
});

describe("when the database fails", () => {
  it("writes nothing when the group or the person's membership can't be read", async () => {
    s.rosterError = FAILED;
    expect((await send({ amount: "10" })).status).toBe(500);
    s.rosterError = null;
    s.signedIn = MATE;
    s.membershipRead = REFUSED;
    expect((await send({ amount: "10" })).status).toBe(500);
    expect(writes()).toEqual([]);
    expect(s.pings).toEqual([]);
  });

  it("answers 500, with no shares written, when the payment can't be written", async () => {
    s.insertError = FAILED;
    expect((await send({ amount: "10" })).status).toBe(500);
    expect(inserted("trip_expense_splits")).toEqual([]);
    expect(s.pings).toEqual([]);
  });

  it("takes the payment back out when its shares can't be written", async () => {
    s.splitError = FAILED;
    expect((await send({ amount: "10" })).status).toBe(500);
    expect(deleted().map((q) => [q.table, q.filters])).toEqual([["trip_expenses", [["eq", "id", EXPENSE_ID]]]]);
    expect(s.expenses).toEqual([]);
    expect(s.pings).toEqual([]);
    expect(s.events).toEqual([]);
  });

  it("doesn't answer an empty ledger when reading it back failed, which wipes what the page shows", async () => {
    existingPayment();
    s.ledgerRead = REFUSED;
    const res = await send({ amount: "10" });
    expect(await res.json()).not.toHaveProperty("expenses");
  });

  it("still answers success then, since the payment was saved and trying again would add it twice", async () => {
    existingPayment();
    s.ledgerRead = REFUSED;
    expect((await send({ amount: "10" })).status).toBe(200);
  });
});

describe("undoing a payment", () => {
  const undo = (expense_id: unknown = EXPENSE_ID) => send({ undo: true, expense_id });

  it("lets whoever logged it take it back, by account or on this browser, and the trip's owner", async () => {
    existingPayment();
    s.signedIn = MATE;
    const res = await undo();
    expect(res.status).toBe(200);
    expect(deleted().map((q) => [q.table, q.filters])).toEqual([["trip_expenses", [["eq", "id", EXPENSE_ID]]]]);
    expect((await res.json()).expenses).toEqual([]);
    expect(s.pings).toEqual([`trip-today:${s.tripId}`]);

    existingPayment({ created_by: null, created_by_cookie_id: GUEST_COOKIE });
    s.cookie = GUEST_COOKIE;
    await undo();
    expect(s.expenses).toEqual([]);

    existingPayment();
    s.signedIn = OWNER;
    s.cookie = undefined;
    await undo();
    expect(s.expenses).toEqual([]);
  });

  it("leaves another member's payment, and a payment on another trip, where they are", async () => {
    existingPayment({ created_by: "mate-2", paid_by_user_id: "mate-2" });
    s.signedIn = MATE;
    await undo();

    existingPayment({ trip_id: "another-trip" });
    s.signedIn = OWNER;
    await undo();

    expect(deleted()).toEqual([]);
    expect(s.expenses).toHaveLength(1);
  });

  it("refuses an id that isn't one, reading nothing", async () => {
    expect((await undo("not-a-uuid")).status).toBe(400);
    expect(service.log).toEqual([]);
  });

  it("answers 500, telling nobody, when the payment can't be removed or read", async () => {
    existingPayment();
    s.deleteError = FAILED;
    expect((await undo()).status).toBe(500);
    expect(deleted()).toHaveLength(1);

    s.undoRead = REFUSED;
    expect((await undo()).status).toBe(500);
    expect(deleted()).toHaveLength(1);
    expect(s.pings).toEqual([]);
  });

  it("answers 403, not success, to someone undoing another member's payment", async () => {
    existingPayment({ created_by: "mate-2", paid_by_user_id: "mate-2" });
    s.signedIn = MATE;
    expect((await undo()).status).toBe(403);
    expect(s.pings).toEqual([]);
  });
});
