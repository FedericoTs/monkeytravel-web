/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import { verifyParticipantUnsubscribeToken } from "@/lib/email/unsubscribe";

/**
 * The in-trip digest fan-out to a trip's emailed participants. A guest has no
 * account to opt out from, so each guest's email carries a link to their own
 * "I'm going" row; a signed-in participant keeps the account's link (made
 * inside dispatchEmail). Drives the real cron with the mailer and the
 * database faked.
 */

const dispatchEmail = vi.fn();
vi.mock("@/lib/email/send", () => ({ dispatchEmail: (options: unknown) => dispatchEmail(options) }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const common = (locale: string) =>
    JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8"));
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({ locale, messages: { common: common(locale) }, namespace: namespace as never }),
  };
});

let client: ReturnType<typeof fakeSupabase>["client"];
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: () => client,
}));

const { GET } = await import("./route");

const OWNER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const TRIP = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
const SHARE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const GUEST_A = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const GUEST_B = "0b5c3a52-6f0e-4c1e-9d3b-8a7f6e5d4c3b";
const MEMBER_ROW = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const MEMBER = "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f6e";
const CRON_SECRET = "cron-test-bearer";

// A trip starting tomorrow, so its day-2 digest is still news whenever this runs.
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const trip = {
  id: TRIP,
  title: "Lisbon Trip",
  start_date: daysFromNow(1),
  end_date: daysFromNow(4),
  reminders_muted: false,
  status: "planning",
  deleted_at: null,
  itinerary: [{ day_number: 2, title: "Alfama", activities: [{ name: "Tram 28", start_time: "09:00" }] }],
  share_token: SHARE,
  trip_locale: "en",
  weather_note: null,
  highlights: null,
  packing_suggestions: null,
  day1: null,
};
const participants = [
  { id: GUEST_A, email: "ana@example.com", user_id: null, participant_cookie_id: "guest-cookie-ana-01" },
  { id: GUEST_B, email: "bo@example.com", user_id: null, participant_cookie_id: "guest-cookie-bo-001" },
  { id: MEMBER_ROW, email: "cy@example.com", user_id: MEMBER, participant_cookie_id: "member-cookie-cy-1" },
];

function answer(q: FakeQuery) {
  switch (q.table) {
    case "scheduled_notifications":
      if (q.op === "update") return { data: [{ id: "queue-row-1" }], error: null };
      // The due rows; the one-a-day check finds nothing sent today.
      return eqOf(q, "status") === "pending"
        ? {
            data: [{ id: "queue-row-1", user_id: OWNER, trip_id: TRIP, slot: "in_trip_day_2", scheduled_for: new Date().toISOString() }],
            error: null,
          }
        : { data: [], error: null };
    case "trips":
      // The trip itself, then its twin check (no other copy).
      return q.end === "maybeSingle" ? { data: trip, error: null } : { data: [trip], error: null };
    case "users":
      return { data: { email: "owner@example.com", preferred_language: "en" }, error: null };
    case "trip_participants":
      return { data: participants, error: null };
    default:
      return { data: null, error: null };
  }
}

async function runCron() {
  const res = await GET(
    new NextRequest("https://monkeytravel.app/api/cron/scheduled-notifications", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
  );
  expect(res.status).toBe(200);
  return dispatchEmail.mock.calls.map(([options]) => options as Record<string, unknown>);
}

beforeEach(() => {
  client = fakeSupabase(answer).client;
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED", "true");
  vi.stubEnv("PARTICIPANT_DIGEST_ENABLED", "true");
  vi.stubEnv("TRIP_NOTIFICATIONS_SEND_CAP", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-for-tests");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://monkeytravel.app");
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
  dispatchEmail.mockReset();
  dispatchEmail.mockResolvedValue({ ok: true, status: "sent" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("digest fan-out to participants", () => {
  it("gives each guest a link to their own row, and nobody else one", async () => {
    const calls = await runCron();
    expect(calls.map((c) => c.recipientEmail)).toEqual([
      "owner@example.com",
      "ana@example.com",
      "bo@example.com",
      "cy@example.com",
    ]);
    const [owner, ana, bo, cy] = calls;

    for (const [guest, row] of [[ana, GUEST_A], [bo, GUEST_B]] as const) {
      expect(guest.recipientUserId).toBeNull();
      const link = new URL(guest.guestUnsubscribeUrl as string);
      expect(`${link.origin}${link.pathname}`).toBe("https://monkeytravel.app/unsubscribe");
      expect(verifyParticipantUnsubscribeToken(link.searchParams.get("token") ?? "")).toEqual({
        ok: true,
        participantId: row,
      });
    }
    // The owner and a signed-in participant unsubscribe through their accounts.
    expect(owner).toMatchObject({ recipientUserId: OWNER, guestUnsubscribeUrl: undefined });
    expect(cy).toMatchObject({ recipientUserId: MEMBER, guestUnsubscribeUrl: undefined });
  });

  it("never emails the share link to someone who said they're going only on the public page", async () => {
    const rows = [
      { ...participants[0], source: "shared" },
      { ...participants[1], source: "public" },
    ];
    // The participants read comes back with its `neq` filters applied, as the database would.
    const kept = (q: FakeQuery) => rows.filter((r) => q.filters.every(([op, column, value]) => op !== "neq" || r[column as keyof typeof r] !== value));
    client = fakeSupabase((q) => (q.table === "trip_participants" ? { data: kept(q), error: null } : answer(q))).client;
    const calls = await runCron();
    expect(calls.map((c) => c.recipientEmail)).toEqual(["owner@example.com", "ana@example.com"]);
  });

  it("does not email a guest it cannot give a working link", async () => {
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = await runCron();
    expect(calls.map((c) => c.recipientEmail)).toEqual(["owner@example.com", "cy@example.com"]);
  });
});
