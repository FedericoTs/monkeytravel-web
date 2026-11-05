// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The feedback outreach goes to everyone who owns a trip, and is a dry run unless told
 * otherwise. The real route runs over rows answered as PostgREST answers them, at most
 * 1,000 per request.
 */

const s = vi.hoisted(() => ({
  admin: true,
  trips: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
  refused: {} as Record<string, string>,
  sent: [] as Array<Record<string, unknown>>,
  log: [] as unknown[],
}));

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedAdmin: async () => ({
    user: s.admin ? { id: "admin-1" } : null,
    errorResponse: s.admin ? null : Response.json({ error: "Forbidden" }, { status: 403 }),
  }),
}));
vi.mock("@/lib/email/send", () => ({
  dispatchEmail: async (options: Record<string, unknown>) => {
    s.sent.push(options);
    return { ok: true, status: "sent" };
  },
}));
vi.mock("@/lib/feedback/token", () => ({ buildFeedbackUrl: (id: string, locale: string) => `https://m.test/f/${id}/${locale}` }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q: FakeQuery) => {
      if (s.refused[q.table]) return { data: null, error: { message: s.refused[q.table] } };
      const from = q.filters.find(([op, column]) => op === "gte" && column === "id")?.[2] as string | undefined;
      const rows = (q.table === "users" ? s.users : s.trips)
        .filter((row) => !from || String(row.id) >= from)
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
      return { data: rows.slice(0, Math.min(q.limitTo ?? 1000, 1000)), error: null };
    });
    s.log = db.log;
    return db.client;
  },
}));

const { POST } = await import("./route");

const id = (prefix: string, i: number) => `${prefix}-${String(i).padStart(6, "0")}`;
const owner = (i: number, extra: Record<string, unknown> = {}) => ({
  id: id("user", i),
  email: `person${i}@mail.example.com`,
  display_name: `Name ${i}`,
  preferred_language: "en",
  notification_settings: {},
  ...extra,
});
const tripOf = (i: number, userId: string | null) => ({ id: id("trip", i), user_id: userId });
const outreach = async (body: Record<string, unknown> = {}) => {
  const res = await POST(new Request("https://monkeytravel.app/api/admin/feedback/outreach", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  s.admin = true;
  s.trips = [];
  s.users = [];
  s.refused = {};
  s.sent = [];
  s.log = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the feedback outreach's cohort", () => {
  it("is everyone who owns a trip, past what one request answers", async () => {
    s.users = Array.from({ length: 1300 }, (_, i) => owner(i));
    s.trips = Array.from({ length: 1200 }, (_, i) => tripOf(i, id("user", i)));
    const { body } = await outreach({ limit: 200 });
    expect(body).toMatchObject({ dryRun: true, cohortSize: 200 });
    expect((s.log as FakeQuery[]).filter((q) => q.table === "users").every((q) => !q.filters.some(([op]) => op === "in"))).toBe(true);
  });

  it("finds an owner far down both tables", async () => {
    s.users = Array.from({ length: 1300 }, (_, i) => owner(i));
    s.trips = [tripOf(1, id("user", 1250))];
    const { body } = await outreach();
    expect(body).toMatchObject({ cohortSize: 1, sample: ["person1250@mail.example.com"] });
  });

  it("finds an owner whose trip is far down the table", async () => {
    s.users = [owner(5)];
    s.trips = Array.from({ length: 1200 }, (_, i) => tripOf(i, i === 1150 ? id("user", 5) : null));
    expect((await outreach()).body).toMatchObject({ cohortSize: 1, sample: ["person5@mail.example.com"] });
  });

  it("leaves out people with no trip, trips with no owner, and those who opted out", async () => {
    s.users = [
      owner(1),
      owner(2),
      owner(3, { notification_settings: { marketingNotifications: false } }),
      owner(4, { notification_settings: { emailNotifications: false } }),
      owner(5, { email: null }),
    ];
    s.trips = [tripOf(1, id("user", 1)), tripOf(3, id("user", 3)), tripOf(4, id("user", 4)), tripOf(5, id("user", 5)), tripOf(6, null)];
    expect((await outreach()).body).toMatchObject({ cohortSize: 1, sample: ["person1@mail.example.com"] });
  });
});

describe("sending", () => {
  beforeEach(() => {
    s.users = [owner(1), owner(2)];
    s.trips = [tripOf(1, id("user", 1)), tripOf(2, id("user", 2))];
  });

  it("is a dry run unless told otherwise", async () => {
    expect((await outreach()).body).toMatchObject({ dryRun: true, cohortSize: 2 });
    expect(s.sent).toEqual([]);
  });

  it("sends one email per person when told to, keyed so it can't repeat", async () => {
    await outreach({ dryRun: false });
    expect(s.sent.map((m) => m.idempotencyKey)).toEqual([`feedback_outreach_v1:${id("user", 1)}`, `feedback_outreach_v1:${id("user", 2)}`]);
  });

  it("sends nothing when nobody owns a trip", async () => {
    s.trips = [];
    const { body } = await outreach({ dryRun: false });
    expect(body).toMatchObject({ cohortSize: 0 });
    expect(s.sent).toEqual([]);
  });

  it("answers 500 and sends nothing when either read fails", async () => {
    s.refused.trips = "read failed";
    expect((await outreach({ dryRun: false })).status).toBe(500);
    s.refused = { users: "read failed" };
    expect((await outreach({ dryRun: false })).status).toBe(500);
    expect(s.sent).toEqual([]);
  });

  it("is only for admins", async () => {
    s.admin = false;
    expect((await outreach({ dryRun: false })).status).toBe(403);
    expect(s.sent).toEqual([]);
  });
});
