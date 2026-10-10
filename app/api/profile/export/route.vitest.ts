// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The data export selected columns that no longer exist, so the database
 * refused those queries and the file shipped with empty trips, checklists and
 * usage while saying it held all of the person's data. It now selects real
 * columns, and any section that fails to load fails the export. The real
 * route runs against a fake Supabase that records what each table was asked.
 */

const USER = "user-1";
const selects: Record<string, string[]> = {};
let failing: string | null;
let stamped: boolean;

const ROWS: Record<string, unknown> = {
  users: { id: USER, email: "traveller@example.com", preferences: {} },
  trips: [{ id: "t1", title: "Lisbon" }],
  ai_conversations: [],
  activity_timelines: [{ id: "tl1", experience_notes: "Lovely" }],
  trip_checklists: [{ id: "c1", text: "Passport", is_checked: true }],
  user_usage: [{ id: "u1", period_type: "monthly", period_key: "2026-10" }],
  ai_usage: [{ id: "a1", action: "generate", input_tokens: 10 }],
};

function fakeSupabase() {
  return {
    from(table: string) {
      let columns = "";
      const result = () =>
        failing === table && columns !== "preferences"
          ? { data: null, error: { message: `column ${table}.gone does not exist` } }
          : { data: ROWS[table], error: null };
      const q = {
        select(c: string) {
          columns = c.replace(/\s+/g, " ").trim();
          (selects[table] ??= []).push(columns);
          return q;
        },
        eq: () => q,
        order: () => q,
        limit: () => q,
        single: async () => result(),
        update: () => {
          stamped = true;
          return { eq: async () => ({ error: null }) };
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return q;
    },
  };
}

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: USER }, supabase: fakeSupabase(), errorResponse: null }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));

const { GET } = await import("./route");

beforeEach(() => {
  for (const k of Object.keys(selects)) delete selects[k];
  failing = null;
  stamped = false;
});

describe("GET /api/profile/export", () => {
  it("ships every section, with the columns each table really has", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trips).toEqual(ROWS.trips);
    expect(body.activityTimelines).toEqual(ROWS.activity_timelines);
    expect(body.tripChecklists).toEqual(ROWS.trip_checklists);
    expect(body.usage).toEqual(ROWS.user_usage);
    expect(body.aiUsageHistory).toEqual(ROWS.ai_usage);
    expect(stamped).toBe(true);

    expect(selects.trips[0]).not.toMatch(/\b(destination|budget_tier|preferences|is_public|share_token)\b/);
    expect(selects.trips[0]).toMatch(/\bbudget\b.*\bitinerary\b/);
    expect(selects.activity_timelines[0]).toContain("experience_notes");
    expect(selects.trip_checklists[0]).toMatch(/\btext\b.*\bis_checked\b/);
    expect(selects.user_usage[0]).toContain("ai_generations_used");
    expect(selects.ai_usage[0]).toMatch(/\baction\b.*\binput_tokens\b.*\bcost_cents\b/);
  });

  it.each(["trips", "trip_checklists", "user_usage", "ai_usage"])(
    "fails instead of shipping an empty %s section, and stamps nothing",
    async (table) => {
      failing = table;
      const res = await GET();
      expect(res.status).toBe(500);
      expect(stamped).toBe(false);
    },
  );
});
