/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { render } from "@react-email/render";
import enMessages from "@/messages/en/common.json";
import esMessages from "@/messages/es/common.json";
import itMessages from "@/messages/it/common.json";
import ptMessages from "@/messages/pt/common.json";
import ParticipantPlanEmail, {
  participantPlanSubject,
  type ParticipantPlanEmailProps,
} from "@/lib/email/templates/ParticipantPlan";
import { verifyPlanReminderUnsubscribeToken } from "@/lib/email/unsubscribe";
import { escapeHtmlText } from "@/lib/email/verify-render";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The reminders before a kept plan's trip: a tick is kept with its time and words, and the plan's link through the
 * trip; each day's run sends what is due once, with the link that deletes the address, and deletes the addresses
 * whose trip has begun, whose plan is gone or whose dates nobody chose.
 */

const MESSAGES = { en: enMessages, es: esMessages, it: itMessages, pt: ptMessages };
type Locale = keyof typeof MESSAGES;
const TOKEN = "T".repeat(22);
const OTHER = "U".repeat(22);
const ID = "2c9e7a41-5b3d-4f8e-9a1c-6d4b2e8f0a73";

type Sent = { template: { id: string; props: ParticipantPlanEmailProps } } & Record<string, unknown>;
const sent: Sent[] = [];
let status: string;

vi.mock("@/lib/email/send", () => ({
  dispatchEmail: async (options: Sent) => {
    sent.push(options);
    return { ok: status === "sent", status };
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: Locale; namespace: string }) =>
    createTranslator({ locale, messages: { common: MESSAGES[locale] }, namespace } as never),
}));

const { keepPlanReminder, sendDuePlanReminders, stopPlanReminder, PLAN_REMINDER_CONSENT } = await import(
  "./plan-reminders"
);

let answer: (q: FakeQuery) => { data: unknown; error: unknown };
let log: FakeQuery[];
const client = () => {
  const fake = fakeSupabase((q) => answer(q));
  log = fake.log;
  return fake.client as never;
};

beforeEach(() => {
  sent.length = 0;
  status = "sent";
  answer = () => ({ data: null, error: null });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://monkeytravel.app");
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "s".repeat(64));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("keepPlanReminder", () => {
  const keep = () =>
    keepPlanReminder(client(), {
      token: TOKEN,
      email: "ana@example.com",
      locale: "it",
      start: "2099-11-12",
      end: "2099-11-14",
    });

  it("keeps the tick with its time and words, one row per plan and address", async () => {
    answer = (q) => (q.table === "plan_reminders" ? { data: { id: ID }, error: null } : { data: null, error: null });
    const before = Date.now();
    expect(await keep()).toBe(ID);
    const [upsert] = log;
    expect(upsert).toMatchObject({ table: "plan_reminders", op: "upsert", columns: "id", end: "single" });
    const row = upsert.value as Record<string, string>;
    expect(row).toMatchObject({ kept_token: TOKEN, email: "ana@example.com", locale: "it", consent_version: PLAN_REMINDER_CONSENT });
    expect(Date.parse(row.consented_at)).toBeGreaterThanOrEqual(before);
  });

  it("keeps the plan's link until two weeks after the trip, never shortening it", async () => {
    answer = (q) => (q.table === "plan_reminders" ? { data: { id: ID }, error: null } : { data: null, error: null });
    await keep();
    const update = log[1];
    expect(update).toMatchObject({ table: "kept_plans", op: "update", value: { expires_at: "2099-11-29T00:00:00.000Z" } });
    expect(eqOf(update, "token")).toBe(TOKEN);
    expect(update.filters).toContainEqual(["lt", "expires_at", "2099-11-29T00:00:00.000Z"]);
  });

  it("answers null, and leaves the plan alone, when the tick can't be kept", async () => {
    answer = () => ({ data: null, error: { message: "down" } });
    expect(await keep()).toBeNull();
    expect(log.map((q) => q.table)).toEqual(["plan_reminders"]);
  });
});

describe("stopPlanReminder", () => {
  it("deletes the row, and says whether there was one", async () => {
    answer = () => ({ data: [{ id: ID }], error: null });
    expect(await stopPlanReminder(client(), ID)).toEqual({ applied: true });
    expect(log[0]).toMatchObject({ table: "plan_reminders", op: "delete" });
    expect(eqOf(log[0], "id")).toBe(ID);
    answer = () => ({ data: [], error: null });
    expect(await stopPlanReminder(client(), ID)).toEqual({ applied: false });
  });

  it("throws when the database fails, so the page says so", async () => {
    answer = () => ({ data: null, error: { message: "down" } });
    await expect(stopPlanReminder(client(), ID)).rejects.toThrow();
  });
});

describe("sendDuePlanReminders", () => {
  type Row = { id: string; kept_token: string; email: string; locale: string | null; sent_slots: string[] | null; consented_at: string };
  type Plan = { token: string; start_date: unknown; end_date: unknown; flexible: unknown; name: unknown; destination: unknown };
  let rows: Row[];
  let plans: Plan[];
  let failing: "rows" | "plans" | null;

  const row = (over: Partial<Row> = {}): Row => ({
    id: ID,
    kept_token: TOKEN,
    email: "ana@example.com",
    locale: "en",
    sent_slots: [],
    consented_at: "2099-11-01T10:00:00Z",
    ...over,
  });
  const plan = (over: Partial<Plan> = {}): Plan => ({
    token: TOKEN,
    start_date: "2099-11-20",
    end_date: "2099-11-23",
    flexible: null,
    name: "Lisbon",
    destination: "Lisbon, Portugal",
    ...over,
  });

  beforeEach(() => {
    rows = [row()];
    plans = [plan()];
    failing = null;
    answer = (q) => {
      if (q.table === "plan_reminders" && q.op === "select") {
        return failing === "rows" ? { data: null, error: { message: "down" } } : { data: rows, error: null };
      }
      if (q.table === "kept_plans") {
        return failing === "plans" ? { data: null, error: { message: "down" } } : { data: plans, error: null };
      }
      return { data: null, error: null };
    };
  });

  const run = (today: string) => sendDuePlanReminders(client(), today);
  const marks = () => log.filter((q) => q.table === "plan_reminders" && q.op === "update");
  const deletes = () => log.filter((q) => q.table === "plan_reminders" && q.op === "delete");

  it("sends the week's reminder 7 days out, with the plan's link and the link that stops them, and marks it", async () => {
    expect(await run("2099-11-13")).toEqual({ sent: 1, failed: 0, removed: 0 });
    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email).toMatchObject({
      recipientEmail: "ana@example.com",
      recipientUserId: null,
      idempotencyKey: `plan_reminder_7d:${ID}`,
      locale: "en",
      metadata: { slot: "plan_reminder_7d" },
    });
    expect(email.template.id).toBe("plan_reminder");
    expect(email.template.props).toMatchObject({
      heading: "Lisbon is coming up",
      intro: enMessages.planReminderEmail.weekIntro,
      planUrl: `https://monkeytravel.app/trips/new?slot=plan_reminder_7d#plan=${TOKEN}`,
      footerLink: "Stop the reminders",
    });
    const stop = new URL(String(email.guestUnsubscribeUrl));
    expect(verifyPlanReminderUnsubscribeToken(stop.searchParams.get("token") ?? "")).toEqual({ ok: true, reminderId: ID });
    expect(marks()).toHaveLength(1);
    expect(marks()[0].value).toEqual({ sent_slots: ["plan_reminder_7d"] });
    expect(eqOf(marks()[0], "id")).toBe(ID);
  });

  it("sends the day before's reminder in the tick's language, and nothing on the days between", async () => {
    rows = [row({ locale: "it", sent_slots: ["plan_reminder_7d"] })];
    expect((await run("2099-11-16")).sent).toBe(0);
    expect(await run("2099-11-19")).toEqual({ sent: 1, failed: 0, removed: 0 });
    expect(sent[0].template.props).toMatchObject({
      heading: "Lisbon, domani",
      planUrl: `https://monkeytravel.app/it/trips/new?slot=plan_reminder_1d#plan=${TOKEN}`,
    });
    expect(marks().at(-1)?.value).toEqual({ sent_slots: ["plan_reminder_7d", "plan_reminder_1d"] });
  });

  it("sends a reminder once", async () => {
    rows = [row({ sent_slots: ["plan_reminder_7d"] })];
    expect(await run("2099-11-13")).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(sent).toEqual([]);
  });

  it("deletes the addresses whose trip has begun, whose plan is gone, or whose dates nobody chose", async () => {
    rows = [
      row({ id: "a" }),
      row({ id: "b", kept_token: OTHER }),
      row({ id: "c", kept_token: "V".repeat(22) }),
      row({ id: "d", kept_token: "W".repeat(22) }),
    ];
    plans = [
      plan({ start_date: "2099-11-13" }),
      plan({ token: OTHER, flexible: "true" }),
      plan({ token: "W".repeat(22), start_date: "someday" }),
    ];
    expect(await run("2099-11-13")).toEqual({ sent: 0, failed: 0, removed: 4 });
    expect(sent).toEqual([]);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].filters).toContainEqual(["in", "id", ["a", "b", "c", "d"]]);
  });

  it("leaves a failed send unmarked, to go on a later run while its window lasts", async () => {
    status = "failed";
    expect(await run("2099-11-13")).toEqual({ sent: 0, failed: 1, removed: 0 });
    expect(marks()).toEqual([]);
  });

  it("marks a repeat or a bounced address without counting it sent, so it isn't tried again", async () => {
    for (const quiet of ["skipped_duplicate", "skipped_suppressed"]) {
      status = quiet;
      expect(await run("2099-11-13"), quiet).toEqual({ sent: 0, failed: 0, removed: 0 });
      expect(marks(), quiet).toHaveLength(1);
    }
  });

  it("reads nothing more when there's no reminder, and reads plans by their tokens only", async () => {
    rows = [];
    expect(await run("2099-11-13")).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(log.map((q) => q.table)).toEqual(["plan_reminders"]);
    expect(log[0].limitTo).toBe(500);

    rows = [row(), row({ id: "b" })];
    await run("2099-11-13");
    const read = log.find((q) => q.table === "kept_plans");
    expect(read?.filters).toEqual([["in", "token", [TOKEN]]]);
  });

  it("throws when the rows or their plans can't be read", async () => {
    failing = "rows";
    await expect(run("2099-11-13")).rejects.toThrow();
    failing = "plans";
    await expect(run("2099-11-13")).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it("renders both reminders in every language, passing the send-time check", async () => {
    for (const locale of Object.keys(MESSAGES) as Locale[]) {
      for (const [today, slots] of [
        ["2099-11-13", []],
        ["2099-11-19", ["plan_reminder_7d"]],
      ] as const) {
        sent.length = 0;
        rows = [row({ locale, sent_slots: [...slots] })];
        await run(today);
        const { template, verify } = sent[0] as unknown as {
          template: { props: ParticipantPlanEmailProps };
          verify: (r: { html: string; text: string; subject: string }) => { ok: boolean; reason?: string };
        };
        const html = await render(
          ParticipantPlanEmail({ ...template.props, unsubscribeUrl: "https://monkeytravel.app/unsubscribe?token=x" }),
        );
        expect(verify({ html, text: "", subject: participantPlanSubject(template.props) }), `${locale} ${today}`).toEqual({
          ok: true,
        });
        expect(html).toContain(escapeHtmlText(MESSAGES[locale].planReminderEmail.footerReason));
      }
    }
  });

  it("names no place that reads like a link", async () => {
    plans = [plan({ name: "see evil.com", destination: "https://evil.example" })];
    await run("2099-11-13");
    expect(sent[0].template.props.heading).toBe("Your trip is coming up");
  });
});
