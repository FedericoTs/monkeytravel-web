/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createTranslator } from "next-intl";
import { render } from "@react-email/render";
import type { NextRequest } from "next/server";
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
 * A kept plan's link goes to an address someone types: in the page's language,
 * once per address per plan, with the token only in the link's fragment. The
 * address and the plan are limited as well as the network, and a place that
 * reads like a link never reaches the email.
 */

const TOKEN = "T".repeat(22);
const MESSAGES = { en: enMessages, es: esMessages, it: itMessages, pt: ptMessages };
type Locale = keyof typeof MESSAGES;

const sent: Array<{ template: { id: string; props: ParticipantPlanEmailProps } } & Record<string, unknown>> = [];
let plan: { start_date: unknown; end_date: unknown; name: unknown; destination: unknown };
let dispatchThrows: boolean;
const limits = { ip: true, plan: true, address: true, checked: [] as string[] };

vi.mock("@/lib/email/send", () => ({
  dispatchEmail: async (options: (typeof sent)[number]) => {
    if (dispatchThrows) throw new Error("resend is down");
    sent.push(options);
    return { ok: true, status: "sent" };
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
      const allowed = namespace.endsWith("-ip") ? limits.ip : namespace.endsWith("-plan") ? limits.plan : limits.address;
      return { allowed };
    },
  }),
}));

const { KEPT_PLAN_SLOT, mayEmailKeptPlan, placeForEmail, sendKeptPlanEmail } = await import("./kept-plan-email");

const sendTo = (locale: string | null, email = "ana@example.com") => sendKeptPlanEmail(plan, { token: TOKEN, email, locale });

beforeEach(() => {
  sent.length = 0;
  plan = { start_date: "2099-11-12", end_date: "2099-11-14", name: "Lisbon", destination: "Lisbon, Portugal" };
  dispatchThrows = false;
  limits.ip = true;
  limits.plan = true;
  limits.address = true;
  limits.checked = [];
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://monkeytravel.app");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendKeptPlanEmail", () => {
  it("sends the plan's link in the page's language, for no account, once per address per plan", async () => {
    expect(await sendTo("it")).toBe("sent");
    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email).toMatchObject({
      recipientEmail: "ana@example.com",
      recipientUserId: null,
      locale: "it",
      metadata: { slot: "kept_plan" },
    });
    expect(email.template.id).toBe("kept_plan");
    expect(email.template.props).toMatchObject({
      heading: "Lisbon: il tuo piano",
      planUrl: `https://monkeytravel.app/it/trips/new?slot=kept_plan#plan=${TOKEN}`,
      ctaLabel: "Apri il mio piano",
      unsubscribeUrl: "https://monkeytravel.app/it/privacy",
    });
    expect(email.template.props.dates).not.toBe("");
    expect(email.idempotencyKey).toBe(`kept_plan:${createHash("sha256").update(`${TOKEN}:ana@example.com`).digest("hex")}`);
  });

  it("keeps the token out of what's logged", async () => {
    await sendTo("en");
    const [email] = sent;
    expect(JSON.stringify(email.metadata)).not.toContain(TOKEN);
    expect(String(email.idempotencyKey)).not.toContain(TOKEN);
    expect(String(email.idempotencyKey)).not.toContain("ana@example.com");
  });

  it("gives an English link no prefix, and treats an unknown language as English", async () => {
    await sendTo("en");
    expect(sent[0].template.props.planUrl).toBe(`https://monkeytravel.app/trips/new?slot=${KEPT_PLAN_SLOT}#plan=${TOKEN}`);
    expect(sent[0].template.props.unsubscribeUrl).toBe("https://monkeytravel.app/privacy");
    await sendTo(null);
    expect(sent[1].template.props.heading).toBe("Lisbon: your plan");
    await sendTo("fr");
    expect(sent[2].template.props.heading).toBe("Lisbon: your plan");
  });

  it("answers rather than throws when the send breaks", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dispatchThrows = true;
    expect(await sendTo("en")).toBe("error");
  });

  it("falls back to the plan's destination, then to words with no place", async () => {
    plan = { ...plan, name: null };
    await sendTo("en");
    expect(sent[0].template.props.heading).toBe("Lisbon: your plan");

    plan = { ...plan, name: "Buy cheap watches at evil.com", destination: "https://evil.example/now" };
    await sendTo("en");
    expect(sent[1].template.props.heading).toBe("Your trip plan");
  });

  it("leaves the dates out when the plan has none", async () => {
    plan = { ...plan, start_date: null, end_date: null };
    await sendTo("en");
    expect(sent[0].template.props.dates).toBe("");
  });

  it("renders an email in every language that passes the send-time check and says why it came", async () => {
    for (const locale of Object.keys(MESSAGES) as Locale[]) {
      sent.length = 0;
      await sendTo(locale);
      const { template, verify } = sent[0] as unknown as {
        template: { props: ParticipantPlanEmailProps };
        verify: (r: { html: string; text: string; subject: string }) => { ok: boolean; reason?: string };
      };
      const { props } = template;
      const html = await render(ParticipantPlanEmail(props));
      const text = participantPlanEmailText(props);
      const subject = participantPlanSubject(props);
      expect(verify({ html, text, subject }), locale).toEqual({ ok: true });
      expect(html).toContain(escapeHtmlText(MESSAGES[locale].keptPlanEmail.footerReason));
      expect(html).toContain(escapeHtmlText(MESSAGES[locale].keptPlanEmail.footerLink));
      expect(html).not.toContain(escapeHtmlText(layoutCopy[locale].footerReason));
      expect(text).toContain(props.planUrl);
      // A render that lost the link is held back.
      expect(verify({ html: html.split(props.planUrl.replace(/&/g, "&amp;")).join(""), text, subject }).ok).toBe(false);
    }
  });

  it("passes the check with no place named", async () => {
    plan = { ...plan, name: "see evil.com", destination: "see evil.com" };
    await sendTo("en");
    const { template, verify } = sent[0] as unknown as {
      template: { props: ParticipantPlanEmailProps };
      verify: (r: { html: string; text: string; subject: string }) => { ok: boolean };
    };
    const html = await render(ParticipantPlanEmail(template.props));
    expect(verify({ html, text: "", subject: participantPlanSubject(template.props) }).ok).toBe(true);
    expect(html).not.toContain("evil.com");
  });
});

describe("placeForEmail", () => {
  it("names a place as far as its first comma", () => {
    expect(placeForEmail("Lisbon, Portugal")).toBe("Lisbon");
    expect(placeForEmail("  New   York ")).toBe("New York");
    expect(placeForEmail("St. Petersburg")).toBe("St. Petersburg");
    expect(placeForEmail("Washington D.C.")).toBe("Washington D.C.");
    expect(placeForEmail("São Paulo")).toBe("São Paulo");
  });

  it("names nothing for what reads like a link or an address", () => {
    for (const text of ["evil.com", "visit www.evil.net now", "https://evil.example", "a/b", "me@evil.example", "go to evil.co today"]) {
      expect(placeForEmail(text), text).toBeNull();
    }
  });

  it("names nothing for empty text, a sentence or something else", () => {
    expect(placeForEmail("")).toBeNull();
    expect(placeForEmail("   ")).toBeNull();
    expect(placeForEmail(null)).toBeNull();
    expect(placeForEmail(7)).toBeNull();
    expect(placeForEmail("I want to visit Athens Ohio Would you please make my itinerary")).toBeNull();
  });
});

describe("mayEmailKeptPlan", () => {
  const request = {} as NextRequest;
  const addressKey = `kept-plan-email-address:${createHash("sha256").update("ana@example.com").digest("hex")}`;

  it("spends the network's allowance, the plan's, then the address's, with the address hashed", async () => {
    expect(await mayEmailKeptPlan(request, TOKEN, "ana@example.com")).toBe(true);
    expect(limits.checked).toEqual(["kept-plan-email-ip", `kept-plan-email-plan:${TOKEN}`, addressKey]);
    expect(limits.checked.join(" ")).not.toContain("ana@example.com");
  });

  it("stops at the first allowance that's spent", async () => {
    limits.address = false;
    expect(await mayEmailKeptPlan(request, TOKEN, "ana@example.com")).toBe(false);

    limits.checked = [];
    limits.plan = false;
    expect(await mayEmailKeptPlan(request, TOKEN, "ana@example.com")).toBe(false);
    expect(limits.checked).toEqual(["kept-plan-email-ip", `kept-plan-email-plan:${TOKEN}`]);

    limits.checked = [];
    limits.ip = false;
    expect(await mayEmailKeptPlan(request, TOKEN, "ana@example.com")).toBe(false);
    expect(limits.checked).toEqual(["kept-plan-email-ip"]);
  });
});
