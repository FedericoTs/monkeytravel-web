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
const filters: Record<string, string[]> = {};
let failing: string | null;
let preferencesReadFails: boolean;
let stamped: boolean;
let stampedWith: Record<string, unknown> | null;

const ROWS: Record<string, unknown> = {
  users: { id: USER, email: "traveller@example.com", preferences: { travelStyles: ["food"] } },
  trips: [{ id: "t1", title: "Lisbon" }],
  ai_conversations: [],
  activity_timelines: [{ id: "tl1", experience_notes: "Lovely" }],
  trip_checklists: [{ id: "c1", text: "Passport", is_checked: true }],
  user_usage: [{ id: "u1", period_type: "monthly", period_key: "2026-10" }],
  ai_usage: [{ id: "a1", action: "generate", input_tokens: 10 }],
  activity_votes: [{ id: "v1", trip_id: "t2", vote_type: "love" }],
  trip_expenses: [{ id: "e1", trip_id: "t2", amount: 42, currency: "EUR" }],
};

function fakeSupabase() {
  return {
    from(table: string) {
      let columns = "";
      const result = () =>
        columns === "preferences"
          ? preferencesReadFails
            ? { data: null, error: { message: "canceling statement due to statement timeout" } }
            : { data: ROWS.users, error: null }
          : failing === table
            ? { data: null, error: { message: `column ${table}.gone does not exist` } }
            : { data: ROWS[table] ?? [], error: null };
      const q = {
        select(c: string) {
          columns = c.replace(/\s+/g, " ").trim();
          (selects[table] ??= []).push(columns);
          return q;
        },
        eq: (column: string, value: unknown) => {
          (filters[table] ??= []).push(`${column}=${value}`);
          return q;
        },
        or: (condition: string) => {
          (filters[table] ??= []).push(`or(${condition})`);
          return q;
        },
        order: () => q,
        limit: () => q,
        single: async () => result(),
        update: (payload: Record<string, unknown>) => {
          stamped = true;
          stampedWith = payload;
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
  for (const k of Object.keys(filters)) delete filters[k];
  failing = null;
  preferencesReadFails = false;
  stamped = false;
  stampedWith = null;
});

describe("the daily stamp in preferences", () => {
  it("keeps the person's preferences when it stamps the export", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(stampedWith?.preferences).toMatchObject({ travelStyles: ["food"], lastDataExport: expect.any(String) });
  });

  it("exports nothing, and overwrites nothing, when the preferences can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    preferencesReadFails = true;
    const res = await GET();
    expect(res.status).toBe(500);
    expect(stamped).toBe(false);
  });
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

  it("holds what the person did on shared trips and around their account", async () => {
    const body = await (await GET()).json();
    expect(body.activityVotes).toEqual(ROWS.activity_votes);
    expect(body.tripExpenses).toEqual(ROWS.trip_expenses);
    for (const section of [
      "tripMemberships",
      "tripInvites",
      "activityReactions",
      "activityProposals",
      "proposalVotes",
      "expenseShares",
      "likedTrips",
      "savedTrips",
      "referralCodes",
      "bananaTransactions",
      "bananaRedemptions",
      "tripReminders",
      "calendarSyncs",
      "calendarConnections",
      "testerAccess",
    ]) {
      expect(body[section]).toEqual([]);
    }
  });

  it("holds every profile column but the key that signs calendar links", async () => {
    await GET();
    const profile = selects.users.find((s) => s.startsWith("id, email"))!;
    for (const column of ["paypal_handle", "venmo_handle", "wise_handle", "current_location", "username", "stats", "last_sign_in_at"]) {
      expect(profile).toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(profile).not.toContain("calendar_hmac");
  });

  it("reads only the person's own rows", async () => {
    await GET();
    for (const table of Object.keys(selects)) {
      const applied = filters[table] ?? [];
      expect(applied.length, table).toBeGreaterThan(0);
      for (const filter of applied) expect(filter, table).toContain(USER);
    }
    expect(filters.trip_invites).toEqual([`created_by=${USER}`]);
    expect(filters.activity_proposals).toEqual([`proposed_by=${USER}`]);
    expect(filters.trip_expenses).toEqual([`or(created_by.eq.${USER},paid_by_user_id.eq.${USER})`]);
  });

  it("never exports a credential, or contact details other people entered", async () => {
    await GET();
    for (const [table, asked] of Object.entries(selects)) {
      for (const columns of asked) {
        expect(columns, table).not.toMatch(
          /\b(token|share_token|claim_token|calendar_hmac|access_token_enc|refresh_token_enc|recipient_email|created_by_name|paid_by_name|created_by_cookie_id|paid_by_cookie_id|participant_cookie_id)\b/
        );
      }
    }
  });

  it("says what it leaves out, and where to ask for it", async () => {
    const body = await (await GET()).json();
    expect(body.exportInfo.dataRetentionNote).toContain("privacy@monkeytravel.app");
    expect(body.exportInfo.dataRetentionNote).not.toMatch(/anonymi[sz]ed/);
  });

  it.each(["trips", "trip_checklists", "user_usage", "ai_usage", "activity_votes", "trip_expenses", "user_calendar_connections"])(
    "fails instead of shipping an empty %s section, and stamps nothing",
    async (table) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      failing = table;
      const res = await GET();
      expect(res.status).toBe(500);
      expect(stamped).toBe(false);
    },
  );
});
