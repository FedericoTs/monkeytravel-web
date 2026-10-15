/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { render } from "@react-email/render";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import TripDayDigestEmail, {
  tripDayDigestEmailText,
  tripDayDigestSubject,
  type TripDayDigestEmailProps,
} from "@/lib/email/templates/TripDayDigest";
import { verifyDayLink } from "@/lib/trips/day-link";

/**
 * The owner's "send tomorrow's plan to the group" box in the in-trip digest:
 * on trips not marked solo, with a plan for the day, for the owner only. Its
 * link carries the day's send key next to the view key. Drives the real cron
 * with the mailer and the database faked.
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
const GUEST = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const CRON_SECRET = "cron-test-bearer";
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
// The digest for day 2 of a trip starting tomorrow: day 2 is the day after.
const DAY_2 = () => daysFromNow(2);

type Dispatched = {
  recipientEmail: string;
  template: { id: string; props: TripDayDigestEmailProps };
  verify: (rendered: { html: string; text: string; subject: string }) => { ok: boolean; reason?: string };
};

async function runDigest(extra: Record<string, unknown> = {}, language = "en"): Promise<Dispatched[]> {
  const trip = {
    id: TRIP,
    title: "Lisbon Trip",
    start_date: daysFromNow(1),
    end_date: daysFromNow(4),
    created_at: new Date().toISOString(),
    reminders_muted: false,
    status: "planning",
    deleted_at: null,
    itinerary: [{ day_number: 2, title: "Alfama", activities: [{ name: "Tram 28", start_time: "09:00" }] }],
    share_token: null,
    shared_at: null,
    trip_locale: "en",
    trip_intent: "group",
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
        return eqOf(q, "status") === "pending"
          ? {
              data: [{ id: "queue-row-1", user_id: OWNER, trip_id: TRIP, slot: "in_trip_day_2", scheduled_for: new Date().toISOString() }],
              error: null,
            }
          : { data: [], error: null };
      case "trips":
        return q.end === "maybeSingle" ? { data: trip, error: null } : { data: [trip], error: null };
      case "users":
        return { data: { email: "owner@example.com", preferred_language: language }, error: null };
      case "trip_participants":
        return {
          data: [{ id: GUEST, email: "ana@example.com", user_id: null, participant_cookie_id: "guest-cookie-ana-01" }],
          error: null,
        };
      default:
        return { data: null, error: null };
    }
  }).client;
  const res = await GET(
    new NextRequest("https://monkeytravel.app/api/cron/scheduled-notifications", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
  );
  expect(res.status).toBe(200);
  return dispatchEmail.mock.calls.map(([options]) => options as Dispatched);
}

beforeEach(() => {
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

describe("send tomorrow's plan to the group", () => {
  it("is in a group trip's digest, with the day's send key next to its view key", async () => {
    const [owner] = await runDigest();
    const { groupSend, tripUrl } = owner.template.props;
    expect(groupSend?.label).toBe("Send tomorrow's plan to the group");
    expect(groupSend?.text).toContain("group chat");

    const url = new URL(groupSend!.url);
    expect(url.pathname).toBe(`/day/${TRIP}/${DAY_2()}`);
    expect(url.searchParams.get("slot")).toBe("in_trip_day_2");
    expect(url.searchParams.get("share")).toBe("group");
    expect(verifyDayLink(TRIP, DAY_2(), url.searchParams.get("k"))).toEqual({ ok: true });
    expect(verifyDayLink(TRIP, DAY_2(), url.searchParams.get("s"), Date.now(), "send")).toEqual({ ok: true });

    // The main button stays the plain day link: it cannot share the trip.
    expect(new URL(tripUrl).searchParams.has("s")).toBe(false);
  });

  it("is in the owner's language", async () => {
    const [owner] = await runDigest({}, "es");
    expect(owner.template.props.groupSend?.label).toBe("Enviar el plan de mañana al grupo");
    expect(new URL(owner.template.props.groupSend!.url).pathname).toBe(`/es/day/${TRIP}/${DAY_2()}`);
  });

  it("is in a trip whose planner never said solo or group", async () => {
    const [owner] = await runDigest({ trip_intent: null });
    expect(owner.template.props.groupSend).toBeDefined();
  });

  it("is not in a solo trip's digest, nor when the day has nothing planned", async () => {
    const [solo] = await runDigest({ trip_intent: "solo" });
    expect(solo.template.props.groupSend).toBeUndefined();

    dispatchEmail.mockClear();
    const [empty] = await runDigest({ itinerary: [{ day_number: 2, title: "Alfama", activities: [] }] });
    expect(empty.template.props.groupSend).toBeUndefined();
  });

  it("is never in a participant's copy", async () => {
    const calls = await runDigest({ share_token: SHARE });
    expect(calls.map((c) => c.recipientEmail)).toEqual(["owner@example.com", "ana@example.com"]);
    expect(calls[0].template.props.groupSend).toBeDefined();
    expect(calls[1].template.props.groupSend).toBeUndefined();
  });

  it("is left out, and the digest still goes, when no link can be signed", async () => {
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [owner] = await runDigest();
    expect(owner.template.props.groupSend).toBeUndefined();
    expect(dispatchEmail).toHaveBeenCalledTimes(1);
  });

  it("passes the check the cron runs on the rendered email", async () => {
    const [owner] = await runDigest();
    const props = owner.template.props;
    const html = await render(TripDayDigestEmail(props));
    expect(html).toContain("share=group");
    const verdict = owner.verify({
      html,
      text: tripDayDigestEmailText(props),
      subject: tripDayDigestSubject({ heading: props.heading, destination: props.destination }),
    });
    expect(verdict).toEqual({ ok: true });
  });
});
