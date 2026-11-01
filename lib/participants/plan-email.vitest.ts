/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { render } from "@react-email/render";
import type { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import enMessages from "@/messages/en/common.json";
import esMessages from "@/messages/es/common.json";
import itMessages from "@/messages/it/common.json";
import ptMessages from "@/messages/pt/common.json";
import ParticipantPlanEmail, {
  participantPlanEmailText,
  participantPlanSubject,
  type ParticipantPlanEmailProps,
} from "@/lib/email/templates/ParticipantPlan";
import { layoutCopy } from "@/lib/email/copy";
import { escapeHtmlText } from "@/lib/email/verify-render";

/**
 * The plan email goes to an address typed on a share link: in the page's
 * language, with the share link and a link that stops it, once per address
 * per trip. It promises the daily plan only when that is queued and goes to
 * participants, and is not sent about a trip that is over.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
const MESSAGES = { en: enMessages, es: esMessages, it: itMessages, pt: ptMessages };
type Locale = keyof typeof MESSAGES;

const sent: Array<{ template: { props: ParticipantPlanEmailProps } } & Record<string, unknown>> = [];
let tripRow: Record<string, unknown> | null;
let tripReadFails: boolean;
let digestQueued: boolean;
let unsubscribeWorks: boolean;
let log: FakeQuery[] = [];
const limits = { ip: true, trip: true, checked: [] as string[] };

vi.mock("@/lib/email/send", () => ({
  dispatchEmail: async (options: (typeof sent)[number]) => {
    sent.push(options);
    return { ok: true, status: "sent" };
  },
}));
vi.mock("@/lib/email/unsubscribe", () => ({
  buildParticipantUnsubscribeUrl: (id: string) => {
    if (!unsubscribeWorks) throw new Error("EMAIL_UNSUBSCRIBE_SECRET is not set");
    return `https://monkeytravel.app/unsubscribe?token=guest-${id}`;
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: Locale; namespace: string }) =>
    createTranslator({ locale, messages: { common: MESSAGES[locale] }, namespace } as never),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (namespace: string) => ({
    check: async (_request: unknown, key?: string) => {
      limits.checked.push(key ? `${namespace}:${key}` : namespace);
      return { allowed: namespace.endsWith("-ip") ? limits.ip : limits.trip };
    },
  }),
}));

const { mayEmailPlan, sendParticipantPlanEmail } = await import("./plan-email");

const admin = () => {
  const fake = fakeSupabase((q) => {
    if (q.table === "trips") return tripReadFails ? { data: null, error: { message: "timeout" } } : { data: tripRow, error: null };
    if (q.table === "scheduled_notifications") return { data: digestQueued ? [{ id: "n-1" }] : [], error: null };
    return { data: null, error: null };
  });
  log = fake.log;
  return fake.client as never;
};
const sendTo = (locale: string | null, email = "ana@example.com") =>
  sendParticipantPlanEmail(admin(), { tripId: "trip-1", shareToken: TOKEN, participantId: "row-1", email, locale });

beforeEach(() => {
  sent.length = 0;
  tripRow = { title: "Lisbon Trip", start_date: "2099-11-12", end_date: "2099-11-14", destination: "Lisbon", trip_locale: "pt" };
  tripReadFails = false;
  digestQueued = true;
  unsubscribeWorks = true;
  limits.ip = true;
  limits.trip = true;
  limits.checked = [];
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://monkeytravel.app");
  vi.stubEnv("PARTICIPANT_DIGEST_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendParticipantPlanEmail", () => {
  it("sends the share link in the page's language, once per address per trip, with the link that stops it", async () => {
    expect(await sendTo("it")).toBe("sent");
    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email).toMatchObject({
      recipientEmail: "ana@example.com",
      recipientUserId: null,
      guestUnsubscribeUrl: "https://monkeytravel.app/unsubscribe?token=guest-row-1",
      idempotencyKey: "participant_plan:trip-1:ana@example.com",
      locale: "it",
      metadata: { trip_id: "trip-1", participant_id: "row-1", slot: "participant_plan" },
    });
    expect(email.template.props).toMatchObject({
      heading: "Lisbon: ecco il piano",
      planUrl: `https://monkeytravel.app/it/shared/${TOKEN}?slot=participant_plan`,
      ctaLabel: "Apri il piano",
    });
  });

  it("falls back to the trip's language, and an English link has no prefix", async () => {
    await sendTo(null);
    expect(sent[0].template.props.heading).toBe("Lisbon: aqui está o plano");
    await sendTo("en");
    expect(sent[1].template.props.planUrl).toBe(`https://monkeytravel.app/shared/${TOKEN}?slot=participant_plan`);
  });

  it("promises the daily plan only while it is queued for the trip and goes to participants", async () => {
    await sendTo("en");
    expect(sent[0].template.props.digestLine).toBe(enMessages.participantPlanEmail.digest);
    const [queued] = log.filter((q) => q.table === "scheduled_notifications");
    expect(eqOf(queued, "trip_id")).toBe("trip-1");
    expect(eqOf(queued, "status")).toBe("pending");
    expect(queued.filters).toContainEqual(["like", "slot", "in_trip_day_%"]);

    digestQueued = false;
    await sendTo("en");
    expect(sent[1].template.props.digestLine).toBeUndefined();

    digestQueued = true;
    vi.stubEnv("PARTICIPANT_DIGEST_ENABLED", "false");
    await sendTo("en");
    expect(sent[2].template.props.digestLine).toBeUndefined();
    expect(log.filter((q) => q.table === "scheduled_notifications")).toEqual([]);
  });

  it("logs a trip it couldn't read as an error, not as a trip that doesn't exist", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tripReadFails = true;
    expect(await sendTo("en")).toBe("error");
    tripReadFails = false;
    tripRow = null;
    expect(await sendTo("en")).toBe("no_trip");
    expect(sent).toEqual([]);
  });

  it("sends nothing about a trip that is over, or without a link that stops it", async () => {
    tripRow = { ...tripRow, end_date: "2020-01-02" };
    expect(await sendTo("en")).toBe("trip_over");
    tripRow = { ...tripRow, end_date: "2099-11-14" };
    unsubscribeWorks = false;
    expect(await sendTo("en")).toBe("no_unsubscribe_link");
    expect(sent).toEqual([]);
  });

  it("renders an email in every language that passes the send-time check and speaks to a guest", async () => {
    for (const locale of Object.keys(MESSAGES) as Locale[]) {
      sent.length = 0;
      await sendTo(locale);
      const { template, verify } = sent[0] as unknown as {
        template: { props: ParticipantPlanEmailProps };
        verify: (r: { html: string; text: string; subject: string }) => { ok: boolean; reason?: string };
      };
      // dispatchEmail adds the guest link before it renders.
      const props = { ...template.props, unsubscribeUrl: "https://monkeytravel.app/unsubscribe?token=guest-row-1" };
      const html = await render(ParticipantPlanEmail(props));
      const text = participantPlanEmailText(props);
      const subject = participantPlanSubject(props);
      expect(verify({ html, text, subject }), locale).toEqual({ ok: true });
      expect(html).toContain(escapeHtmlText(MESSAGES[locale].participantPlanEmail.footerReason));
      expect(html).toContain(escapeHtmlText(MESSAGES[locale].participantPlanEmail.footerLink));
      expect(html).not.toContain(escapeHtmlText(layoutCopy[locale].footerReason));
      expect(text).toContain(props.planUrl);
      expect(text).toContain(props.unsubscribeUrl);
      // A render that lost the link is held back.
      expect(verify({ html: html.split(props.planUrl.replace(/&/g, "&amp;")).join(""), text, subject }).ok).toBe(false);
    }
  });
});

describe("mayEmailPlan", () => {
  it("spends this network's allowance, then the trip's", async () => {
    const request = {} as NextRequest;
    expect(await mayEmailPlan(request, "trip-1")).toBe(true);
    expect(limits.checked).toEqual(["shared-plan-email-ip", "shared-plan-email-trip:trip-1"]);

    limits.trip = false;
    expect(await mayEmailPlan(request, "trip-1")).toBe(false);

    limits.checked = [];
    limits.ip = false;
    expect(await mayEmailPlan(request, "trip-1")).toBe(false);
    expect(limits.checked).toEqual(["shared-plan-email-ip"]);
  });
});
