/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";
import { render } from "@react-email/render";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import TripReminderEmail, {
  tripReminderEmailText,
  tripReminderSubject,
  type TripReminderEmailProps,
} from "@/lib/email/templates/TripReminder";
import { verifyDayLink } from "@/lib/trips/day-link";

/**
 * What stands between this cron and a bad send to real people. The route and what
 * it hands rows to run for real, over an in-memory queue and with the mailer faked,
 * so each rule is proven by what happens to the rows: what went out, what stayed
 * pending and what was written back, and why.
 */

const dispatchEmail = vi.fn();
vi.mock("@/lib/email/send", () => ({ dispatchEmail: (options: unknown) => dispatchEmail(options) }));

const copy = vi.hoisted(() => ({ missing: false }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const fs = await import("fs");
  const path = await import("path");
  const common = (locale: string) =>
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", locale, "common.json"), "utf8"));
  return {
    // With no copy, next-intl hands back the key path instead of throwing, as it does for a real miss.
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({
        locale,
        messages: { common: copy.missing ? {} : common(locale) },
        namespace: namespace as never,
        onError: () => {},
      }),
  };
});

let client: unknown;
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: () => client,
}));

const { GET } = await import("./route");

const OWNER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CRON_SECRET = "cron-test-bearer";
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

type Row = Record<string, unknown> & { id: string; status: string; trip_id: string | null };
type Trip = Record<string, unknown> & { id: string };

let rows: Row[];
let trips: Trip[];
let recipient: { email: string | null; preferred_language: string };
let cameBack: boolean;
let invites: number;
/** Refuses the queries it names, with this message. */
let refuse: (q: FakeQuery) => string | null;
let queries: FakeQuery[];

/** A trip a week out with nothing unusual about it. */
const trip = (id: string, extra: Record<string, unknown> = {}): Trip => ({
  id,
  user_id: OWNER,
  title: `Trip ${id}`,
  start_date: daysFromNow(7),
  end_date: daysFromNow(10),
  created_at: hoursAgo(24 * 30),
  updated_at: hoursAgo(24),
  reminders_muted: false,
  status: "planning",
  deleted_at: null,
  itinerary: [],
  share_token: null,
  shared_at: null,
  trip_locale: "en",
  trip_intent: null,
  dates_pencilled: null,
  weather_note: null,
  highlights: null,
  packing_suggestions: null,
  day1: null,
  ...extra,
});

let queued = 0;
/** A due queue row. Queued in the order written, so the run reaches them in that order. */
const due = (id: string, tripId: string | null, slot = "visa_check_7d", extra: Record<string, unknown> = {}): Row => ({
  id,
  user_id: OWNER,
  trip_id: tripId,
  slot,
  scheduled_for: new Date(Date.now() - 3_600_000 + queued++ * 1000).toISOString(),
  status: "pending",
  sent_at: null,
  skipped_reason: null,
  last_error: null,
  ...extra,
});

const passes = (row: Record<string, unknown>, q: FakeQuery) =>
  q.filters.every(([op, column, value]) => {
    const actual = row[column];
    switch (op) {
      case "eq":
        return actual === value;
      case "neq":
        return actual !== value;
      case "is":
        return value === null ? actual === null || actual === undefined : actual === value;
      case "in":
        return (value as unknown[]).includes(actual);
      case "lte":
        return String(actual) <= String(value);
      case "gte":
        return actual !== null && actual !== undefined && String(actual) >= String(value);
      default:
        return true;
    }
  });

/** Only the columns asked for, as a real select returns: a dropped column reads as missing. */
const selected = (row: Record<string, unknown>, columns: string | undefined) =>
  !columns
    ? row
    : Object.fromEntries(
        columns
          .split(",")
          .map((c) => c.trim().split(":")[0])
          .map((name) => [name, row[name]])
      );

function answer(q: FakeQuery) {
  queries.push(q);
  const refusal = refuse(q);
  if (refusal) return { data: null, error: { message: refusal }, count: null };
  switch (q.table) {
    case "scheduled_notifications": {
      const hits = rows.filter((r) => passes(r, q));
      if (q.op === "update") {
        for (const r of hits) Object.assign(r, q.value);
        return { data: hits.map((r) => ({ id: r.id })), error: null };
      }
      return { data: hits.map((r) => selected(r, q.columns)), error: null };
    }
    case "trips": {
      const hits = trips.filter((t) => passes(t, q));
      if (q.columns === "id") return { data: null, count: hits.length, error: null };
      const found = hits.map((t) => selected(t, q.columns));
      return { data: q.end === "maybeSingle" ? (found[0] ?? null) : found, error: null };
    }
    case "users":
      return { data: q.op === "select" ? recipient : null, error: null };
    case "page_views":
      return { data: q.end === "maybeSingle" ? null : cameBack ? [{ id: "view" }] : [], error: null };
    case "trip_invites":
      return { data: null, count: invites, error: null };
    default:
      return { data: q.end === "list" ? [] : null, error: null };
  }
}

async function run(headers: Record<string, string> = { authorization: `Bearer ${CRON_SECRET}` }) {
  client = {
    ...fakeSupabase(answer).client,
    auth: { admin: { getUserById: async () => ({ data: { user: { last_sign_in_at: null } }, error: null }) } },
  };
  const res = await GET(new NextRequest("https://monkeytravel.app/api/cron/scheduled-notifications", { headers }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

type Dispatched = {
  recipientEmail: string;
  locale: string;
  template: { id: string; props: TripReminderEmailProps & Record<string, unknown> };
  verify: (rendered: { html: string; text: string; subject: string }) => { ok: boolean; reason?: string };
};
const sends = () => dispatchEmail.mock.calls.map(([options]) => options as Dispatched);
const row = (id: string) => rows.find((r) => r.id === id)!;
const sentTrips = () => sends().map((s) => (s.template.props.tripUrl as string).match(/trips\/([^?/]+)/)?.[1]);

const messages = (locale: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8"));

beforeEach(() => {
  rows = [];
  trips = [];
  queries = [];
  queued = 0;
  recipient = { email: "owner@example.com", preferred_language: "en" };
  cameBack = false;
  invites = 0;
  refuse = () => null;
  copy.missing = false;
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED", "true");
  vi.stubEnv("TRIP_NOTIFICATIONS_SEND_CAP", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-for-tests");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://monkeytravel.app");
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
  dispatchEmail.mockReset();
  dispatchEmail.mockResolvedValue({ ok: true, status: "sent" });
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Five ordinary due reminders, one trip each. */
const fiveDue = () => {
  trips = ["a", "b", "c", "d", "e"].map((id) => trip(id));
  rows = trips.map((t) => due(`row-${t.id}`, t.id));
};

describe("who may run it", () => {
  it("refuses a request without the secret, before reading anything", async () => {
    fiveDue();
    const { status } = await run({});
    expect(status).toBe(401);
    expect(queries).toEqual([]);
    expect(sends()).toEqual([]);
  });

  it("sends nothing with the feature off, whatever is due", async () => {
    vi.stubEnv("NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED", "false");
    fiveDue();
    expect((await run()).body).toMatchObject({ success: true, skipped: "feature_disabled" });
    expect(queries).toEqual([]);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });
});

describe("which rows it picks up", () => {
  it.each(["sent", "suppressed", "failed"])("a row already %s isn't sent again", async (status) => {
    trips = [trip("a")];
    rows = [due("row-a", "a", "visa_check_7d", { status })];
    expect((await run()).body).toMatchObject({ due: 0, sent: 0 });
    expect(sends()).toEqual([]);
    expect(row("row-a").status).toBe(status);
  });

  it("a row that isn't due yet stays pending", async () => {
    trips = [trip("a")];
    rows = [due("row-a", "a", "visa_check_7d", { scheduled_for: new Date(Date.now() + 3_600_000).toISOString() })];
    expect((await run()).body).toMatchObject({ due: 0, sent: 0 });
    expect(sends()).toEqual([]);
    expect(row("row-a").status).toBe("pending");
  });
});

describe("the send cap", () => {
  it("with none set, sends everything due and says nothing of a cap", async () => {
    fiveDue();
    const { body } = await run();
    expect(body).toMatchObject({ due: 5, sent: 5, skipped: 0, failed: 0 });
    expect(body).not.toHaveProperty("cap");
    expect(body).not.toHaveProperty("deferredByCap");
    expect(rows.every((r) => r.status === "sent")).toBe(true);
  });

  it("sends that many, leaves the rest pending and untouched, and says what it deferred", async () => {
    vi.stubEnv("TRIP_NOTIFICATIONS_SEND_CAP", "2");
    fiveDue();
    const { body } = await run();
    expect(sends()).toHaveLength(2);
    expect(body).toMatchObject({ due: 5, sent: 2, cap: 2, deferredByCap: 3 });
    expect(body.note).toContain("3 due row(s) left pending");
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent", "pending", "pending", "pending"]);
    for (const id of ["row-c", "row-d", "row-e"]) expect(row(id)).not.toHaveProperty("updated_at");
  });

  it("counts emails sent, not rows looked at", async () => {
    vi.stubEnv("TRIP_NOTIFICATIONS_SEND_CAP", "2");
    trips = [
      trip("m1", { reminders_muted: true }),
      trip("m2", { reminders_muted: true }),
      trip("m3", { reminders_muted: true }),
      trip("a"),
      trip("b"),
      trip("c"),
    ];
    rows = trips.map((t) => due(`row-${t.id}`, t.id));
    const { body } = await run();
    expect(sends()).toHaveLength(2);
    expect(body).toMatchObject({ due: 6, sent: 2, skipped: 3, deferredByCap: 1 });
    expect(row("row-c").status).toBe("pending");
  });

  it.each(["lots", "-3", "0"])("reads %s as zero: never as no limit", async (cap) => {
    vi.stubEnv("TRIP_NOTIFICATIONS_SEND_CAP", cap);
    fiveDue();
    const { body } = await run();
    expect(sends()).toEqual([]);
    expect(body).toMatchObject({ sent: 0, cap: 0, deferredByCap: 5 });
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("leaves a waiting twin copy pending too, once the cap is reached", async () => {
    vi.stubEnv("TRIP_NOTIFICATIONS_SEND_CAP", "1");
    trips = [trip("older", { title: "Lisbon" }), trip("newer", { title: "Lisbon", updated_at: hoursAgo(1) })];
    rows = [due("row-older", "older"), due("row-newer", "newer")];
    const { body } = await run();
    expect(sentTrips()).toEqual(["newer"]);
    expect(body).toMatchObject({ sent: 1, deferredByCap: 1 });
    expect(row("row-older").status).toBe("pending");
    expect(row("row-older")).not.toHaveProperty("updated_at");
  });
});

describe("rows that must not send", () => {
  it.each([
    ["a muted trip", { reminders_muted: true }, "trip_muted"],
    ["a cancelled trip", { status: "cancelled" }, "trip_cancelled"],
    ["a deleted trip", { deleted_at: hoursAgo(1) }, "trip_deleted"],
    ["dates only pencilled in", { dates_pencilled: { start: daysFromNow(7), end: daysFromNow(10) } }, "dates_pencilled"],
  ])("%s is suppressed at dispatch", async (_name, extra, reason) => {
    trips = [trip("a", extra)];
    rows = [due("row-a", "a")];
    expect((await run()).body).toMatchObject({ sent: 0, skipped: 1 });
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "suppressed", skipped_reason: reason });
  });

  it("a trip that no longer exists is suppressed", async () => {
    rows = [due("row-a", "gone")];
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "suppressed", skipped_reason: "trip_missing" });
  });

  it("a reminder whose moment has passed is suppressed: it would be wrong, not late", async () => {
    trips = [trip("a", { start_date: daysFromNow(-1), end_date: daysFromNow(2) })];
    rows = [due("row-a", "a")];
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a").status).toBe("suppressed");
    expect(String(row("row-a").skipped_reason)).toContain("stale");
  });

  it("someone with no address is suppressed", async () => {
    recipient = { email: null, preferred_language: "en" };
    trips = [trip("a")];
    rows = [due("row-a", "a")];
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "suppressed", skipped_reason: "no_email" });
  });

  it("a mailer that says it skipped leaves the row suppressed, with its reason", async () => {
    dispatchEmail.mockResolvedValue({ ok: true, status: "skipped_disabled" });
    trips = [trip("a")];
    rows = [due("row-a", "a")];
    expect((await run()).body).toMatchObject({ sent: 0, skipped: 1 });
    expect(row("row-a")).toMatchObject({ status: "suppressed", skipped_reason: "skipped_disabled" });
  });

  it.each(["planning", "confirmed", null])("a trip with status %s still gets its reminders", async (status) => {
    trips = [trip("a", { status })];
    rows = [due("row-a", "a")];
    await run();
    expect(sends()).toHaveLength(1);
    expect(row("row-a").status).toBe("sent");
  });
});

describe("what it can't read, it doesn't send", () => {
  const refusing = (table: string, when: (q: FakeQuery) => boolean = () => true) => (q: FakeQuery) =>
    q.table === table && q.op === "select" && when(q) ? "read failed" : null;

  it("a failed read of the queue answers 500", async () => {
    fiveDue();
    refuse = refusing("scheduled_notifications");
    const { status, body } = await run();
    expect(status).toBe(500);
    expect(body.error).toBe("due_select_failed");
    expect(sends()).toEqual([]);
  });

  it("a failed read of the trip fails the row", async () => {
    trips = [trip("a")];
    rows = [due("row-a", "a")];
    refuse = refusing("trips", (q) => q.end === "maybeSingle");
    expect((await run()).body).toMatchObject({ sent: 0, failed: 1 });
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "failed", skipped_reason: "trip_load_error" });
  });

  it("a failed read of today's sends fails the row: better one lost slot than spam", async () => {
    trips = [trip("a")];
    rows = [due("row-a", "a")];
    refuse = refusing("scheduled_notifications", (q) => q.filters.some(([, c, v]) => c === "status" && v === "sent"));
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "failed", skipped_reason: "rate_limit_read_error" });
  });

  it("a failed read of the recipient fails the row", async () => {
    trips = [trip("a")];
    rows = [due("row-a", "a")];
    refuse = refusing("users");
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "failed", skipped_reason: "user_load_error" });
  });

  it("one row that throws fails alone: the rest of the batch still goes", async () => {
    dispatchEmail.mockRejectedValueOnce(new Error("mailer down"));
    fiveDue();
    const { body } = await run();
    expect(body).toMatchObject({ due: 5, sent: 4, failed: 1 });
    expect(row("row-a")).toMatchObject({ status: "failed", last_error: "mailer down" });
    expect(row("row-e").status).toBe("sent");
  });

  it("a mailer failure fails the row, with the mailer's reason", async () => {
    dispatchEmail.mockResolvedValue({ ok: false, status: "failed", error: "provider said no" });
    trips = [trip("a")];
    rows = [due("row-a", "a")];
    expect((await run()).body).toMatchObject({ sent: 0, failed: 1 });
    expect(row("row-a")).toMatchObject({ status: "failed", skipped_reason: "dispatch_error", last_error: "provider said no" });
  });
});

describe("one email a day, per trip", () => {
  it("a slot is suppressed when the trip already sent one today", async () => {
    trips = [trip("a")];
    rows = [
      due("row-sent", "a", "pack_early_14d", { status: "sent", sent_at: new Date().toISOString() }),
      due("row-a", "a"),
    ];
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "suppressed", skipped_reason: "rate_limit_sibling_same_day" });
  });

  it("yesterday's send doesn't count", async () => {
    trips = [trip("a")];
    rows = [
      due("row-sent", "a", "pack_early_14d", { status: "sent", sent_at: hoursAgo(25 + new Date().getUTCHours()) }),
      due("row-a", "a"),
    ];
    await run();
    expect(sends()).toHaveLength(1);
  });

  it("two trips of one person each get theirs", async () => {
    trips = [trip("a"), trip("b", { start_date: daysFromNow(7), title: "Another" })];
    rows = [due("row-a", "a"), due("row-b", "b")];
    await run();
    expect(sends()).toHaveLength(2);
  });
});

describe("twin copies of one trip", () => {
  const twins = () => {
    trips = [trip("older", { title: "Lisbon" }), trip("newer", { title: "lisbon ", updated_at: hoursAgo(1) })];
    rows = [due("row-older", "older"), due("row-newer", "newer")];
  };

  it("send one email: the copy updated last sends, and the other is suppressed naming it", async () => {
    twins();
    const { body } = await run();
    expect(sentTrips()).toEqual(["newer"]);
    expect(body).toMatchObject({ due: 2, sent: 1, skipped: 1 });
    expect(row("row-newer").status).toBe("sent");
    expect(row("row-older")).toMatchObject({ status: "suppressed", skipped_reason: "twin_trip:newer" });
  });

  it("still send one when the chosen copy fails: a lost reminder is worse than a duplicate", async () => {
    twins();
    dispatchEmail.mockResolvedValueOnce({ ok: false, status: "failed", error: "provider said no" });
    await run();
    expect(sentTrips()).toEqual(["newer", "older"]);
    expect(row("row-newer").status).toBe("failed");
    expect(row("row-older").status).toBe("sent");
  });

  it("share the one-email-a-day limit", async () => {
    trips = [trip("older", { title: "Lisbon" }), trip("newer", { title: "Lisbon", updated_at: hoursAgo(1) })];
    rows = [
      due("row-older-sent", "older", "pack_early_14d", { status: "sent", sent_at: new Date().toISOString() }),
      due("row-newer", "newer"),
    ];
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-newer")).toMatchObject({ status: "suppressed", skipped_reason: "rate_limit_sibling_same_day" });
  });

  it("never see a sent row rewritten as suppressed", async () => {
    // Another run sends this row while this one is at the mailer, which then reports a duplicate.
    trips = [trip("a")];
    rows = [due("row-a", "a")];
    const sentAt = new Date().toISOString();
    dispatchEmail.mockImplementation(async () => {
      Object.assign(row("row-a"), { status: "sent", sent_at: sentAt });
      return { ok: true, status: "skipped_duplicate" };
    });
    await run();
    expect(row("row-a")).toMatchObject({ status: "sent", sent_at: sentAt, skipped_reason: null });
  });

  it("a failed read of the copies sends as if there were none", async () => {
    trips = [trip("a")];
    rows = [due("row-a", "a")];
    refuse = (q) => (q.table === "trips" && q.end === "list" && q.columns !== "id" ? "read failed" : null);
    await run();
    expect(sends()).toHaveLength(1);
  });
});

describe("the post-trip follow-ups", () => {
  const finished = (extra: Record<string, unknown> = {}) =>
    trip("a", { start_date: daysFromNow(-6), end_date: daysFromNow(-3), title: "Lisbon", ...extra });

  it("go to someone who came back after making the trip", async () => {
    cameBack = true;
    trips = [finished()];
    rows = [due("row-a", "a", "followup_return_3d")];
    await run();
    expect(sends().map((s) => s.template.id)).toEqual(["trip_followup"]);
    expect(row("row-a").status).toBe("sent");
  });

  it("not to someone who never did", async () => {
    trips = [finished()];
    rows = [due("row-a", "a", "followup_return_3d")];
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "suppressed", skipped_reason: "no_engagement" });
  });

  it("stop once they plan another trip", async () => {
    cameBack = true;
    trips = [finished(), trip("next", { title: "Rome" })];
    rows = [due("row-a", "a", "followup_return_3d")];
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "suppressed", skipped_reason: "user_has_new_trip" });
  });

  it("not counting a deleted trip as another", async () => {
    cameBack = true;
    trips = [finished(), trip("gone", { title: "Rome", deleted_at: hoursAgo(1) })];
    rows = [due("row-a", "a", "followup_return_3d")];
    await run();
    expect(sends()).toHaveLength(1);
  });

  it("fail closed when the trip count can't be read: unknown is not one-and-done", async () => {
    cameBack = true;
    trips = [finished()];
    rows = [due("row-a", "a", "followup_return_3d")];
    refuse = (q) => (q.table === "trips" && q.columns === "id" ? "read failed" : null);
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "failed", skipped_reason: "trip_count_read_error" });
  });

  it("fail closed when the coming back can't be read", async () => {
    trips = [finished()];
    rows = [due("row-a", "a", "followup_return_3d")];
    refuse = (q) => (q.table === "email_log" ? "read failed" : null);
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "failed", skipped_reason: "engagement_read_error" });
  });

  it("name the day the trip ended", async () => {
    cameBack = true;
    trips = [finished()];
    rows = [due("row-a", "a", "followup_return_3d")];
    await run();
    const end = new Date(`${daysFromNow(-3)}T12:00:00Z`);
    const day = new Intl.DateTimeFormat("en", { day: "numeric", timeZone: "UTC" }).format(end);
    expect(String(sends()[0].template.props.body)).toMatch(new RegExp(`\\b${day}\\b`));
  });
});

describe("the copy", () => {
  const reminderSlots = [
    ["pack_early_14d", 14],
    ["visa_check_7d", 7],
    ["weather_3d", 3],
    ["confirm_1d", 1],
    ["morning_of", 0],
  ] as const;

  describe.each(["en", "es", "it", "pt"])("in %s", (language) => {
    beforeEach(() => {
      recipient = { email: "owner@example.com", preferred_language: language };
    });

    it.each(reminderSlots)("%s is the real reminder, with the destination in it", async (slot, days) => {
      trips = [trip("a", { title: "Lisbon Trip", start_date: daysFromNow(days), end_date: daysFromNow(days + 3) })];
      rows = [due("row-a", "a", slot)];
      await run();
      const [sent] = sends();
      expect(sent.locale).toBe(language);
      const words = messages(language).tripReminderEmail;
      expect(sent.template.props.ctaLabel).toBe(words.cta);
      expect(String(sent.template.props.body)).toBe(String(words[slot].body).replace(/\{destination\}/g, String(sent.template.props.destination)));
    });

    it("the follow-up is the real one", async () => {
      cameBack = true;
      trips = [trip("a", { title: "Lisbon Trip", start_date: daysFromNow(-6), end_date: daysFromNow(-3) })];
      rows = [due("row-a", "a", "followup_return_3d")];
      await run();
      const words = messages(language).tripFollowupEmail.followup_return_3d;
      expect(sends()[0].template.props.heading).toBe(String(words.heading).replace(/\{destination\}/g, String(sends()[0].template.props.destination)));
    });

    it("the day digest is the real one", async () => {
      trips = [
        trip("a", {
          title: "Lisbon Trip",
          start_date: daysFromNow(1),
          end_date: daysFromNow(4),
          itinerary: [{ day_number: 2, title: "Alfama", activities: [{ name: "Tram 28", start_time: "09:00" }] }],
        }),
      ];
      rows = [due("row-a", "a", "in_trip_day_2")];
      await run();
      const [sent] = sends();
      expect(sent.template.id).toBe("trip_day_digest");
      expect(sent.template.props.ctaLabel).toBe(messages(language).tripDayDigestEmail.cta);
    });
  });

  it.each([
    ["a reminder", "visa_check_7d", 7, 10],
    ["a day digest", "in_trip_day_2", 1, 4],
  ])("%s whose copy doesn't resolve isn't sent: the row fails, visibly", async (_name, slot, start, end) => {
    copy.missing = true;
    trips = [trip("a", { start_date: daysFromNow(start), end_date: daysFromNow(end) })];
    rows = [due("row-a", "a", slot)];
    expect((await run()).body).toMatchObject({ sent: 0, failed: 1 });
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "failed", skipped_reason: "i18n_load_error" });
  });

  it("a follow-up whose copy doesn't resolve isn't sent either", async () => {
    copy.missing = true;
    cameBack = true;
    trips = [trip("a", { start_date: daysFromNow(-6), end_date: daysFromNow(-3) })];
    rows = [due("row-a", "a", "followup_return_3d")];
    await run();
    expect(sends()).toEqual([]);
    expect(row("row-a")).toMatchObject({ status: "failed", skipped_reason: "i18n_load_error" });
  });
});

describe("asking to add the people coming", () => {
  const group = (extra: Record<string, unknown> = {}, days = 7) =>
    trip("a", { trip_intent: "group", start_date: daysFromNow(days), end_date: daysFromNow(days + 3), ...extra });

  it.each([
    ["visa_check_7d", 7],
    ["pack_early_14d", 14],
  ])("%s asks on a group trip nobody has been invited to", async (slot, days) => {
    trips = [group({}, days)];
    rows = [due("row-a", "a", slot)];
    await run();
    expect(sends()[0].template.props.groupAsk?.url).toBe(`https://monkeytravel.app/trips/a?slot=${slot}&share=invite`);
  });

  it.each([
    ["a later reminder", () => group({}, 3), "weather_3d"],
    ["a solo trip", () => group({ trip_intent: "solo" }), "visa_check_7d"],
    ["a trip already shared", () => group({ shared_at: hoursAgo(1) }), "visa_check_7d"],
  ])("doesn't ask on %s", async (_name, make, slot) => {
    trips = [make()];
    rows = [due("row-a", "a", slot)];
    await run();
    expect(sends()).toHaveLength(1);
    expect(sends()[0].template.props.groupAsk).toBeUndefined();
  });

  it("doesn't ask once someone has been invited", async () => {
    invites = 1;
    trips = [group()];
    rows = [due("row-a", "a")];
    await run();
    expect(sends()[0].template.props.groupAsk).toBeUndefined();
  });

  it("a failed read of the invites just leaves the ask out", async () => {
    refuse = (q) => (q.table === "trip_invites" ? "read failed" : null);
    trips = [group()];
    rows = [due("row-a", "a")];
    await run();
    expect(sends()).toHaveLength(1);
    expect(sends()[0].template.props.groupAsk).toBeUndefined();
  });
});

describe("the check on the rendered email, before it goes", () => {
  /** A reminder whose trip has every kind of enrichment, some with quotes in it. */
  const ready = async () => {
    trips = [
      trip("a", {
        title: "Lisbon Trip",
        highlights: ['Sunset at "Miradouro" da Graça', "Tram 28 through Alfama"],
        packing_suggestions: ['A light "just in case" jacket'],
        day1: { activities: [{ name: 'Café "A Brasileira"', start_time: "09:00" }] },
      }),
    ];
    rows = [due("row-a", "a")];
    await run();
    const [sent] = sends();
    const props = { ...sent.template.props, locale: sent.locale as TripReminderEmailProps["locale"] };
    return {
      sent,
      rendered: {
        html: await render(TripReminderEmail(props)),
        text: tripReminderEmailText(props),
        subject: tripReminderSubject(props),
      },
    };
  };

  it("passes an email made from the trip's own values, quotes included", async () => {
    const { sent, rendered } = await ready();
    expect(rendered.html).toContain("Miradouro");
    expect(sent.verify(rendered)).toEqual({ ok: true });
  });

  it.each(["undefined", "[object Object]", "tripReminderEmail.visa_check_7d.heading", "{destination}"])(
    "refuses one with %s in it",
    async (poison) => {
      const { sent, rendered } = await ready();
      const verdict = sent.verify({ ...rendered, html: rendered.html.replace("</body>", `<p>${poison}</p></body>`) });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toContain("poison");
    }
  );

  it("refuses one with an unresolved subject", async () => {
    const { sent, rendered } = await ready();
    expect(sent.verify({ ...rendered, subject: "tripReminderEmail.visa_check_7d.subject" }).ok).toBe(false);
  });

  it("refuses one whose button goes somewhere else", async () => {
    const { sent, rendered } = await ready();
    const elsewhere = rendered.html.replaceAll(String(sent.template.props.tripUrl).replace(/&/g, "&amp;"), "https://example.com/");
    expect(sent.verify({ ...rendered, html: elsewhere }).ok).toBe(false);
  });

  it("doesn't hold an email back for a long subject alone", async () => {
    const { sent, rendered } = await ready();
    expect(sent.verify({ ...rendered, subject: `${rendered.subject} ${"very long ".repeat(20)}` })).toEqual({ ok: true });
  });
});

describe("the day digest's button", () => {
  it("opens the signed day page", async () => {
    const id = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
    trips = [
      trip(id, {
        start_date: daysFromNow(1),
        end_date: daysFromNow(4),
        itinerary: [{ day_number: 2, title: "Alfama", activities: [{ name: "Tram 28", start_time: "09:00" }] }],
      }),
    ];
    rows = [due("row-a", id, "in_trip_day_2")];
    await run();
    const url = new URL(String(sends()[0].template.props.tripUrl));
    expect(url.pathname).toBe(`/day/${id}/${daysFromNow(2)}`);
    expect(verifyDayLink(id, daysFromNow(2), url.searchParams.get("k"))).toEqual({ ok: true });
  });
});
