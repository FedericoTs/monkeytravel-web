/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { render } from "@react-email/render";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import TripReminderEmail, {
  tripReminderEmailText,
  tripReminderSubject,
  type TripReminderEmailProps,
} from "@/lib/email/templates/TripReminder";
import { verifyDayLink } from "@/lib/trips/day-link";

/**
 * The reminder's button and the send-time check must follow the same link, or
 * the check holds the email back. Drives the real cron with the mailer and the
 * database faked, then runs the cron's own check on what the template renders.
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
const CRON_SECRET = "cron-test-bearer";
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type Dispatched = {
  locale: string;
  template: { id: string; props: TripReminderEmailProps };
  verify: (rendered: { html: string; text: string; subject: string }) => { ok: boolean; reason?: string };
};

/** One due reminder row through the cron; returns the trip and what reached the mailer. */
async function runReminder(slot: string, startsInDays: number, language: string, extra: Record<string, unknown> = {}) {
  const trip = {
    id: TRIP,
    title: "Lisbon Trip",
    start_date: daysFromNow(startsInDays),
    end_date: daysFromNow(startsInDays + 3),
    created_at: new Date().toISOString(),
    reminders_muted: false,
    status: "planning",
    deleted_at: null,
    itinerary: [],
    share_token: null,
    shared_at: null,
    trip_locale: "en",
    trip_intent: null,
    weather_note: null,
    highlights: null,
    packing_suggestions: null,
    day1: null,
    ...extra,
  };
  client = fakeSupabase((q: FakeQuery) => {
    switch (q.table) {
      case "scheduled_notifications":
        if (q.op === "update") return { data: [{ id: "queue-row-1" }], error: null };
        // The due row; the one-a-day check finds nothing sent today.
        return eqOf(q, "status") === "pending"
          ? { data: [{ id: "queue-row-1", user_id: OWNER, trip_id: TRIP, slot, scheduled_for: new Date().toISOString() }], error: null }
          : { data: [], error: null };
      case "trips":
        // The trip itself, then its twin check (no other copy).
        return q.end === "maybeSingle" ? { data: trip, error: null } : { data: [trip], error: null };
      case "users":
        return { data: { email: "owner@example.com", preferred_language: language }, error: null };
      default:
        return { data: null, error: null };
    }
  }).client;
  dispatchEmail.mockClear();
  const res = await GET(
    new NextRequest("https://monkeytravel.app/api/cron/scheduled-notifications", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
  );
  expect(res.status).toBe(200);
  expect(dispatchEmail).toHaveBeenCalledTimes(1);
  const sent = dispatchEmail.mock.calls[0][0] as Dispatched;
  expect(sent.template.id).toBe("trip_reminder");
  return { trip, sent };
}

/** The cron's check on the rendered email, rendered the way dispatchEmail renders it. */
async function check(sent: Dispatched) {
  const props = { ...sent.template.props, locale: sent.locale as TripReminderEmailProps["locale"] };
  const html = await render(TripReminderEmail(props));
  return sent.verify({ html, text: tripReminderEmailText(props), subject: tripReminderSubject(props) });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED", "true");
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

describe("reminder button", () => {
  it("opens trip day 1 the day before and the morning of departure, and passes the send-time check", async () => {
    for (const [slot, startsInDays, language, prefix] of [
      ["confirm_1d", 1, "en", ""],
      ["morning_of", 0, "it", "/it"],
    ] as const) {
      const { trip, sent } = await runReminder(slot, startsInDays, language);
      const link = new URL(sent.template.props.tripUrl);
      expect(`${link.origin}${link.pathname}`).toBe(`https://monkeytravel.app${prefix}/day/${TRIP}/${trip.start_date}`);
      expect(link.searchParams.get("slot")).toBe(slot);
      expect(verifyDayLink(TRIP, trip.start_date, link.searchParams.get("k"))).toEqual({ ok: true });
      expect(await check(sent)).toEqual({ ok: true });
    }
  });

  it("keeps the trip page, and the group ask's link, on the other reminders", async () => {
    const { sent } = await runReminder("visa_check_7d", 7, "es", { trip_intent: "group" });
    expect(sent.template.props.tripUrl).toBe(`https://monkeytravel.app/trips/${TRIP}?slot=visa_check_7d`);
    expect(sent.template.props.groupAsk?.url).toBe(`https://monkeytravel.app/trips/${TRIP}?slot=visa_check_7d&share=invite`);
    expect(await check(sent)).toEqual({ ok: true });
  });
});
