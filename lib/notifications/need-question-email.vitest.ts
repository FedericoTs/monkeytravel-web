/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { render } from "@react-email/render";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import TripReminderEmail, {
  tripReminderEmailText,
  tripReminderSubject,
  type TripReminderEmailProps,
} from "@/lib/email/templates/TripReminder";
import { verifyFeedbackToken } from "@/lib/feedback/token";
import { NEED_ANSWERS } from "@/lib/feedback/need";
import { prioritizeDueRows, staleReason } from "./queue";
import type { SlotRow, TripEmailRow } from "./slot-row";

/**
 * need_10d: "What do you still need for your trip to Lisbon?" as one email of
 * its own, ten days before the trip, once per person. The reminders already
 * end with this question until it's answered; this email IS the question, so
 * it goes with its six one-tap answers or not at all, and it is held back for
 * anything that makes asking wrong.
 */

const { dispatchEmail } = vi.hoisted(() => ({ dispatchEmail: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ dispatchEmail }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const fs = await import("fs");
  const path = await import("path");
  const common = (locale: string) =>
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", locale, "common.json"), "utf8"));
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({ locale, messages: { common: common(locale) }, namespace: namespace as never, onError: () => {} }),
  };
});

const { sendSlotEmail } = await import("./slot-email");
const { NEED_EMAIL_DAYS } = await import("./need-email");

const ROOT = join(__dirname, "..", "..");
const OWNER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const TRIP = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
const LOCALES = ["en", "es", "it", "pt"] as const;
type Locale = (typeof LOCALES)[number];

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const messages = (locale: string) =>
  JSON.parse(readFileSync(join(ROOT, "messages", locale, "common.json"), "utf8"));
const href = (url: string) => `href="${url.replace(/&/g, "&amp;")}"`;

/** A trip starting in `startsIn` days with nothing unusual about it. */
const tripIn = (startsIn: number, extra: Partial<TripEmailRow> = {}): TripEmailRow => ({
  id: TRIP,
  title: "Lisbon Trip",
  start_date: daysFromNow(startsIn),
  end_date: daysFromNow(startsIn + 3),
  created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  reminders_muted: false,
  status: "planning",
  is_archived: false,
  deleted_at: null,
  itinerary: [],
  weather_note: null,
  highlights: null,
  packing_suggestions: null,
  day1: null,
  share_token: null,
  trip_locale: "en",
  trip_intent: null,
  shared_at: null,
  dates_pencilled: null,
  ...extra,
});

const dueRow = (slot: SlotRow["slot"] = "need_10d"): SlotRow => ({
  id: "row-1",
  user_id: OWNER,
  trip_id: TRIP,
  slot,
  scheduled_for: new Date().toISOString(),
});

/** Answers on record: trip id and the answer. */
let answers: { trip: string; need: string }[];
/** The person's other queue rows. */
let queue: { id: string; user_id: string; trip_id: string; slot: string; status: string }[];
/** users.notification_settings for the owner. */
let settings: Record<string, unknown> | null;
/** Refuses the queries it names, with this message. */
let refuse: (q: FakeQuery) => string | null;
let log: FakeQuery[];

function svc() {
  const fake = fakeSupabase((q) => {
    const refusal = refuse(q);
    if (refusal) return { data: null, error: { message: refusal } };
    switch (q.table) {
      case "user_feedback": {
        const trip = eqOf(q, "extra->>trip_id");
        return { data: answers.filter((a) => a.trip === trip).map(() => ({ id: "answer" })), error: null };
      }
      case "scheduled_notifications": {
        if (q.op === "update") return { data: [{ id: "row-1" }], error: null };
        const hits = queue.filter((r) =>
          q.filters.every(([op, column, value]) => op !== "eq" || (r as Record<string, unknown>)[column] === value)
        );
        return { data: hits.map((r) => ({ id: r.id })), error: null };
      }
      case "users":
        return { data: { notification_settings: settings }, error: null };
      default:
        return { data: null, error: null };
    }
  });
  log = fake.log;
  return fake.client as unknown as Parameters<typeof sendSlotEmail>[0];
}

type Dispatched = {
  recipientEmail: string;
  recipientUserId: string;
  idempotencyKey: string;
  locale: string;
  template: { id: string; props: TripReminderEmailProps };
  metadata: Record<string, unknown>;
  verify: (rendered: { html: string; text: string; subject: string }) => { ok: boolean; reason?: string };
};

/** One due row through sendSlotEmail; what came back, what reached the mailer, and what the row became. */
async function send(trip: TripEmailRow, { locale = "en" as Locale, slot = "need_10d" as SlotRow["slot"] } = {}) {
  dispatchEmail.mockClear();
  const outcome = await sendSlotEmail(svc(), dueRow(slot), trip, "owner@example.com", locale, false);
  const calls = dispatchEmail.mock.calls.map(([options]) => options as Dispatched);
  const written = log.filter((q) => q.table === "scheduled_notifications" && q.op === "update").map((q) => q.value);
  return { outcome, sent: calls[0] as Dispatched | undefined, calls, written };
}

/** The email as dispatchEmail renders it, and the cron's own check on it. */
async function rendered(sent: Dispatched) {
  const props = { ...sent.template.props, locale: sent.locale as TripReminderEmailProps["locale"] };
  return {
    props,
    html: await render(TripReminderEmail(props)),
    text: tripReminderEmailText(props),
    subject: tripReminderSubject(props),
  };
}

beforeEach(() => {
  answers = [];
  queue = [];
  settings = { tripReminders: true, marketingNotifications: true };
  refuse = () => null;
  log = [];
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://monkeytravel.app");
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("FEEDBACK_LINK_SECRET", "");
  dispatchEmail.mockReset();
  dispatchEmail.mockResolvedValue({ ok: true, status: "sent" });
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the email, when it goes", () => {
  it("asks the question in its subject and heading, with six signed one-tap answers, keyed to the person", async () => {
    const { outcome, sent } = await send(tripIn(10));
    expect(outcome).toBe("sent");
    expect(sent).toBeDefined();
    const words = messages("en").tripReminderEmail;
    const { props } = sent!.template;
    expect(sent!.template.id).toBe("trip_reminder");
    expect(props.slot).toBe("need_10d");
    expect(props.questionOnly).toBe(true);
    expect(props.heading).toBe("What do you still need for your trip to Lisbon?");
    expect(props.body).toBe(words.need_10d.body);
    expect(tripReminderSubject(props)).toBe(props.heading);
    // Once per person, whichever trip asks: not the per-trip key the reminders use.
    expect(sent!.idempotencyKey).toBe(`need_ask:${OWNER}`);
    expect(sent!.recipientUserId).toBe(OWNER);
    expect(sent!.metadata).toMatchObject({ slot: "need_10d", trip_id: TRIP });

    // The same six answers, in the same words, as the reminders' block.
    expect(props.needAsk?.answers.map((a) => a.label)).toEqual(NEED_ANSWERS.map((n) => words.needAsk[n]));
    const links = props.needAsk!.answers.map((a) => new URL(a.url));
    expect(links.map((l) => l.searchParams.get("need"))).toEqual([...NEED_ANSWERS]);
    for (const link of links) {
      expect(link.origin + link.pathname).toBe("https://monkeytravel.app/feedback/need");
      expect(link.searchParams.get("slot")).toBe("need_10d");
      expect(verifyFeedbackToken(link.searchParams.get("t")!)).toEqual({ ok: true, userId: OWNER, tripId: TRIP });
    }
  });

  it("is the question and its answers: no button, the question asked once, and it passes the check before it goes", async () => {
    const { sent } = await send(tripIn(10));
    const { props, html, text, subject } = await rendered(sent!);
    for (const answer of props.needAsk!.answers) {
      expect(html).toContain(href(answer.url));
      expect(text).toContain(`${answer.label}: ${answer.url}`);
    }
    // No main button competing with the answers.
    expect(html).not.toContain(href(props.tripUrl));
    expect(html).not.toContain(props.ctaLabel);
    expect(text).not.toContain(props.tripUrl);
    // The heading is the question: the block's own question line isn't added under it.
    expect(html).not.toContain(messages("en").tripReminderEmail.needAsk.question);
    expect(text.split(props.heading)).toHaveLength(2);
    expect(sent!.verify({ html, text, subject })).toEqual({ ok: true });
  });

  it("is held back at the last check if any answer doesn't reach the reader", async () => {
    const { sent } = await send(tripIn(10));
    const { props, html, text, subject } = await rendered(sent!);
    const broken = html.replace(href(props.needAsk!.answers[2].url), 'href="https://monkeytravel.app/"');
    const verdict = sent!.verify({ html: broken, text, subject });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("need_answers_missing");
  });

  it.each(LOCALES)("in %s, the subject is the question and names the trip once", async (locale) => {
    const { sent } = await send(tripIn(10), { locale });
    const words = messages(locale).tripReminderEmail;
    const { props, html, text, subject } = await rendered(sent!);
    expect(props.heading).toBe(String(words.need_10d.heading).replace("{destination}", "Lisbon"));
    expect(subject).toBe(props.heading);
    expect(subject.split("Lisbon")).toHaveLength(2);
    expect(subject.trim().endsWith("?")).toBe(true);
    for (const copy of [props.heading, props.body]) expect(copy).not.toMatch(/[!¡]/);
    expect(props.needAsk?.answers.map((a) => a.label)).toEqual(NEED_ANSWERS.map((n) => words.needAsk[n]));
    expect(new URL(props.needAsk!.answers[0].url).pathname).toBe(
      locale === "en" ? "/feedback/need" : `/${locale}/feedback/need`
    );
    expect(sent!.verify({ html, text, subject })).toEqual({ ok: true });
  });

  it.each([7, 10, 13])("goes %i days before the trip", async (days) => {
    expect((await send(tripIn(days))).outcome).toBe("sent");
  });

  it.each([
    ["a missing switch", { tripReminders: true }],
    ["no settings at all", null],
  ])("goes with %s: only an explicit no to marketing stops it", async (_name, value) => {
    settings = value;
    expect((await send(tripIn(10))).outcome).toBe("sent");
  });
});

describe("held back", () => {
  const heldAs = async (trip: TripEmailRow, reason: string, status: "suppressed" | "failed" = "suppressed") => {
    const { outcome, calls, written } = await send(trip);
    expect(calls).toEqual([]);
    expect(outcome).toBe(status === "failed" ? "failed" : "skipped");
    expect(written).toEqual([expect.objectContaining({ status, skipped_reason: reason })]);
  };

  it("once the trip has an answer", async () => {
    answers = [{ trip: TRIP, need: "stay" }];
    await heldAs(tripIn(10), "trip_answered");
  });

  it("once the person has had it, about any trip", async () => {
    queue = [{ id: "other-row", user_id: OWNER, trip_id: "another-trip", slot: "need_10d", status: "sent" }];
    await heldAs(tripIn(10), "already_asked");
  });

  it("but not for a row of theirs that never went, or another slot that did", async () => {
    queue = [
      { id: "r1", user_id: OWNER, trip_id: "another-trip", slot: "need_10d", status: "suppressed" },
      { id: "r2", user_id: OWNER, trip_id: "another-trip", slot: "visa_check_7d", status: "sent" },
      { id: "r3", user_id: "someone-else", trip_id: "their-trip", slot: "need_10d", status: "sent" },
    ];
    expect((await send(tripIn(10))).outcome).toBe("sent");
  });

  it("when they said no to marketing: it is a question for us, not a reminder", async () => {
    settings = { tripReminders: true, marketingNotifications: false };
    await heldAs(tripIn(10), "marketing_opted_out");
  });

  it.each([6, 3, 0, -2, 14, 20])("when the trip is %i days away: its dates moved", async (days) => {
    await heldAs(tripIn(days), "dates_moved");
  });

  it("when its links can't be signed: never without its answers", async () => {
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "");
    vi.stubEnv("FEEDBACK_LINK_SECRET", "");
    await heldAs(tripIn(10), "links_unsigned");
  });

  it.each([
    ["the answers", "user_feedback", "answer_read_error"],
    ["who has had it", "scheduled_notifications", "asked_read_error"],
    ["the person's settings", "users", "settings_read_error"],
  ])("as a failure when %s can't be read", async (_name, table, reason) => {
    refuse = (q) => (q.table === table && q.op === "select" ? "read failed" : null);
    await heldAs(tripIn(10), reason, "failed");
  });
});

describe("the reminders' own question is as it was", () => {
  it("still ends a reminder, keyed per trip and slot, without the email's checks", async () => {
    const { outcome, sent } = await send(tripIn(14), { slot: "pack_early_14d" });
    expect(outcome).toBe("sent");
    const { props } = sent!.template;
    expect(sent!.idempotencyKey).toBe(`trip_reminder:${TRIP}:pack_early_14d`);
    expect(props.questionOnly).toBeUndefined();
    expect(props.needAsk?.question).toBe(messages("en").tripReminderEmail.needAsk.question);
    expect(props.needAsk?.answers).toHaveLength(NEED_ANSWERS.length);
    expect(new URL(props.needAsk!.answers[0].url).searchParams.get("slot")).toBe("pack_early_14d");
    expect(log.some((q) => q.table === "users")).toBe(false);
    expect(log.some((q) => q.table === "scheduled_notifications" && q.op === "select")).toBe(false);
    const { html } = await rendered(sent!);
    expect(html).toContain(href(props.tripUrl));
  });

  it("is left out once the trip has an answer, and the reminder still goes", async () => {
    answers = [{ trip: TRIP, need: "book" }];
    const { outcome, sent } = await send(tripIn(7), { slot: "visa_check_7d" });
    expect(outcome).toBe("sent");
    expect(sent!.template.props.needAsk).toBeUndefined();
  });
});

describe("timing", () => {
  const TODAY = new Date("2026-09-10T07:00:00Z");
  const startsIn = (days: number) => {
    const d = new Date(TODAY);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  it("goes up to three days late, while a week is left to help, and never early-stale", () => {
    expect(staleReason("need_10d", startsIn(10), TODAY)).toBeNull();
    expect(staleReason("need_10d", startsIn(7), TODAY)).toBeNull();
    expect(staleReason("need_10d", startsIn(13), TODAY)).toBeNull();
    expect(staleReason("need_10d", startsIn(6), TODAY)).toBe("stale_need_10d_4d_late");
  });

  it("the stale rule and the send window agree on every day", () => {
    for (let days = -3; days <= 30; days++) {
      const notStale = staleReason("need_10d", startsIn(days), TODAY) === null;
      const inWindow = days >= NEED_EMAIL_DAYS.min && days <= NEED_EMAIL_DAYS.max;
      expect(notStale && days <= NEED_EMAIL_DAYS.max, `day ${days}`).toBe(inWindow);
    }
  });

  it("under a send cap, goes after the reminders that can't wait and before the post-trip follow-ups", () => {
    const row = (slot: string, scheduled_for: string) => ({ id: slot, slot, scheduled_for });
    const rows = [
      row("followup_return_3d", "2026-09-01T06:00:00Z"),
      row("need_10d", "2026-09-08T06:00:00Z"),
      row("visa_check_7d", "2026-09-10T06:00:00Z"),
      row("confirm_1d", "2026-09-10T06:00:00Z"),
    ];
    expect(prioritizeDueRows(rows).map((r) => r.slot)).toEqual([
      "confirm_1d",
      "visa_check_7d",
      "need_10d",
      "followup_return_3d",
    ]);
  });
});

describe("the migration", () => {
  const dir = join(ROOT, "supabase", "migrations");
  const migration = (suffix: string) => {
    const name = readdirSync(dir).find((n) => n.endsWith(suffix));
    expect(name, `no migration ending ${suffix}`).toBeTruthy();
    return readFileSync(join(dir, name!), "utf8").toLowerCase();
  };
  /** The names a scheduled_notifications.slot CHECK lists, in order. */
  const checkedSlots = (sql: string) => {
    const check = sql.match(/add constraint scheduled_notifications_slot_check check \(([\s\S]*?)\n\);/)?.[1] ?? "";
    const names = check.match(/array\[([\s\S]*?)\]/)?.[1] ?? "";
    return [...names.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  };
  /** The body of one function the migration creates. */
  const fn = (sql: string, name: string) =>
    sql.match(new RegExp(`function public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0] ?? "";

  it("restates every slot the queue already allows, plus need_10d, before anything else", () => {
    const before = checkedSlots(migration("_finish_trip_email.sql"));
    const sql = migration("_need_question_email.sql");
    expect(before.length).toBe(10);
    expect(checkedSlots(sql)).toEqual([...before, "need_10d"]);
    expect(sql).toContain(String.raw`or slot ~ '^in_trip_day_([2-9]|1[0-9]|2[01])$'`);
    expect(sql).toMatch(/check \(\(trip_id is null\) = \(slot = 'finish_trip_1d'\)\)/);
    expect(sql.indexOf("scheduled_notifications_slot_check")).toBeLessThan(sql.indexOf("create or replace function"));
  });

  it("leaves the cascade, the digests, the follow-ups and their triggers alone", () => {
    const sql = migration("_need_question_email.sql");
    for (const name of ["enqueue_trip_notifications", "enqueue_trip_day_digests", "enqueue_trip_followups"]) {
      expect(sql).not.toContain(name);
    }
    expect([...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1])).toEqual([
      "enqueue_need_ask",
      "trg_enqueue_need_ask",
    ]);
    expect([...sql.matchAll(/create trigger (\w+)/g)].map((m) => m[1])).toEqual(["trips_enqueue_need_ask"]);
    expect([...sql.matchAll(/drop trigger if exists (\w+)/g)].map((m) => m[1])).toEqual(["trips_enqueue_need_ask"]);
  });

  it("queues one row ten days out at 06:00 UTC, moves only a pending one, and clears it when the trip no longer qualifies", () => {
    const body = fn(migration("_need_question_email.sql"), "enqueue_need_ask");
    expect(body).toContain("security definer");
    expect(body).toContain("deleted_at is null");
    expect(body).toContain("interval '6 hours'");
    expect(body).toContain("interval '10 days'");
    expect(body).toMatch(/on conflict \(trip_id, slot\) do update[\s\S]*where scheduled_notifications\.status = 'pending'/);
    expect(body).toMatch(/delete from scheduled_notifications\s+where trip_id = p_trip_id and slot = 'need_10d' and status = 'pending'/);
  });

  it("enqueues from a trigger that can never fail a trip write", () => {
    const sql = migration("_need_question_email.sql");
    const body = fn(sql, "trg_enqueue_need_ask");
    const perform = body.indexOf("perform public.enqueue_need_ask(new.id)");
    expect(perform).toBeGreaterThan(-1);
    expect(body.lastIndexOf("begin", perform)).toBeGreaterThan(body.indexOf("begin"));
    expect(body.indexOf("exception when others then")).toBeGreaterThan(perform);
    expect(body).toContain("raise warning");
    // The guard that skips unchanged saves runs outside that block, so it must
    // not be able to fail: OLD is only read once the trigger knows it's an update.
    expect(body.indexOf("old.")).toBeGreaterThan(body.indexOf("if tg_op = 'update' then"));
    expect(body.indexOf("if tg_op = 'update' then")).toBeGreaterThan(-1);
    expect(sql).toMatch(/after insert or update of start_date, user_id, deleted_at on public\.trips/);
  });

  it("backfills only trips at least eleven days away, never over an existing row", () => {
    const sql = migration("_need_question_email.sql");
    const backfill = sql.slice(sql.lastIndexOf("insert into public.scheduled_notifications"));
    expect(backfill).toContain("user_id is not null");
    expect(backfill).toContain("deleted_at is null");
    expect(backfill).toMatch(/start_date >= .*\+ 11/);
    expect(backfill).toContain("on conflict (trip_id, slot) do nothing");
  });

  it("lets only the service role call its functions", () => {
    const sql = migration("_need_question_email.sql");
    expect(sql).toContain("revoke execute on function public.enqueue_need_ask(uuid) from public, anon, authenticated");
    expect(sql).toContain("revoke execute on function public.trg_enqueue_need_ask() from public, anon, authenticated");
  });
});
