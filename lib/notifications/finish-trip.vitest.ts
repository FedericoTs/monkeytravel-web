/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createTranslator } from "next-intl";
import { render } from "@react-email/render";
import type { SupabaseClient } from "@supabase/supabase-js";

const { dispatchEmail } = vi.hoisted(() => ({ dispatchEmail: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ dispatchEmail }));

import {
  FINISH_TRIP_NS,
  FINISH_TRIP_SLOT,
  clearDestination,
  finishTripCtaUrl,
  finishTripLocale,
  sendFinishTripEmail,
  type FinishTripTranslator,
} from "./finish-trip";
import FinishTripEmail, { finishTripSubject } from "@/lib/email/templates/FinishTrip";

const ROOT = join(__dirname, "..", "..");
const USER = "6f1c2b9e-4d3a-4e8b-9a7c-1b2d3e4f5a6b";
const ROW = { id: "row-1", user_id: USER };

function messagesFor(locale: string) {
  const raw = readFileSync(join(ROOT, "messages", locale, "common.json"), "utf8");
  return { common: JSON.parse(raw) } as Parameters<typeof createTranslator>[0]["messages"];
}

const translatorFor = async (locale: string) =>
  createTranslator({ locale, messages: messagesFor(locale), namespace: FINISH_TRIP_NS }) as FinishTripTranslator;

interface FakeDb {
  user?: { email?: string | null; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> } | null;
  authError?: string;
  counts?: Partial<Record<"trips" | "trip_collaborators" | "trip_participants", number>>;
  countError?: string;
  paths?: string[];
  destinations?: (string | null)[];
}

/** A Supabase stand-in: answers the reads finish-trip makes and records every filter. */
function fakeSvc(db: FakeDb) {
  const filters: Array<[string, string, unknown]> = [];
  const from = (table: string) => {
    const result = () => {
      if (table === "page_views") return { data: (db.paths ?? []).map((path) => ({ path })), error: null };
      if (table === "wizard_step_events") {
        return { data: (db.destinations ?? []).map((destination) => ({ destination })), error: null };
      }
      return {
        count: db.counts?.[table as keyof NonNullable<FakeDb["counts"]>] ?? 0,
        error: db.countError ? { message: db.countError } : null,
      };
    };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit"]) builder[method] = () => builder;
    builder.eq = (column: string, value: unknown) => {
      filters.push([table, column, value]);
      return builder;
    };
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return builder;
  };
  const getUserById = vi.fn(async () =>
    db.authError
      ? { data: { user: null }, error: { message: db.authError } }
      : { data: { user: db.user === undefined ? confirmedUser() : db.user }, error: null },
  );
  const svc = { from: vi.fn(from), auth: { admin: { getUserById } } } as unknown as SupabaseClient;
  return { svc, filters };
}

function confirmedUser(extra: Partial<NonNullable<FakeDb["user"]>> = {}) {
  return { email: "traveller@example.com", email_confirmed_at: "2026-10-08T10:00:00Z", user_metadata: {}, ...extra };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://monkeytravel.app");
  dispatchEmail.mockReset();
  dispatchEmail.mockResolvedValue({ ok: true, status: "sent" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("finishTripLocale", () => {
  it("follows the locale prefix of the account's own page views", () => {
    expect(finishTripLocale(["/es/trips/new", "/es", "/trips/new"], undefined)).toBe("es");
    expect(finishTripLocale(["/it/trips/new"], "en")).toBe("it");
    expect(finishTripLocale(["/pt/explore", "/pt/trips/new", "/es"], undefined)).toBe("pt");
  });

  it("keeps English on a tie or for unprefixed paths", () => {
    expect(finishTripLocale(["/es/trips/new", "/trips/new"], "es")).toBe("en");
    expect(finishTripLocale(["/trips/new", "/profile"], "it")).toBe("en");
    expect(finishTripLocale(["/estonia-guide"], undefined)).toBe("en");
  });

  it("falls back to the signup locale, then English, without page views", () => {
    expect(finishTripLocale([], "pt-BR")).toBe("pt");
    expect(finishTripLocale([], "fr")).toBe("en");
    expect(finishTripLocale([], undefined)).toBe("en");
  });
});

describe("clearDestination", () => {
  it("returns the one place every entry names, in its newest spelling", () => {
    expect(clearDestination(["Lisbon", " lisbon ", "LISBON"])).toBe("Lisbon");
    expect(clearDestination(["Paris  &  Amsterdam"])).toBe("Paris & Amsterdam");
  });

  it("prefills nothing when the entries disagree, are empty or are not a place name", () => {
    expect(clearDestination(["Lisbon", "Porto"])).toBeNull();
    expect(clearDestination([null, "", "   "])).toBeNull();
    expect(clearDestination([])).toBeNull();
    expect(clearDestination(["x".repeat(61)])).toBeNull();
  });
});

describe("finishTripCtaUrl", () => {
  it("opens the planner in the email's language with the slot for click tracking", () => {
    expect(finishTripCtaUrl("https://monkeytravel.app", "en", null)).toBe(
      "https://monkeytravel.app/trips/new?slot=finish_trip_1d",
    );
    expect(finishTripCtaUrl("https://monkeytravel.app", "es", "São Paulo & Rio")).toBe(
      "https://monkeytravel.app/es/trips/new?slot=finish_trip_1d&destination=S%C3%A3o+Paulo+%26+Rio",
    );
  });
});

describe("sendFinishTripEmail: who gets it", () => {
  it.each([
    [{ counts: { trips: 1 } }, "user_has_trip"],
    [{ counts: { trip_collaborators: 1 } }, "user_joined_trip"],
    [{ counts: { trip_participants: 2 } }, "user_joined_trip"],
    [{ user: confirmedUser({ email_confirmed_at: null }) }, "email_unconfirmed"],
    [{ user: confirmedUser({ email: null }) }, "no_email"],
    [{ user: null }, "no_email"],
  ] as Array<[FakeDb, string]>)("suppresses %o as %s without sending", async (db, reason) => {
    const { svc } = fakeSvc(db);
    expect(await sendFinishTripEmail(svc, ROW, translatorFor)).toEqual({ status: "suppressed", reason });
    expect(dispatchEmail).not.toHaveBeenCalled();
  });

  it("fails closed when it cannot read the account or its trips", async () => {
    const auth = await sendFinishTripEmail(fakeSvc({ authError: "boom" }).svc, ROW, translatorFor);
    expect(auth).toMatchObject({ status: "failed", reason: "user_load_error" });
    const trips = await sendFinishTripEmail(fakeSvc({ countError: "timeout" }).svc, ROW, translatorFor);
    expect(trips).toMatchObject({ status: "failed", reason: "trip_read_error" });
    expect(dispatchEmail).not.toHaveBeenCalled();
  });

  it("reads only the recipient's own rows", async () => {
    const { svc, filters } = fakeSvc({ paths: ["/es/trips/new"], destinations: ["Lisboa"] });
    await sendFinishTripEmail(svc, ROW, translatorFor);
    const tables = new Set(filters.map(([table]) => table));
    expect(tables).toEqual(new Set(["trips", "trip_collaborators", "trip_participants", "page_views", "wizard_step_events"]));
    for (const table of tables) {
      expect(filters).toContainEqual([table, "user_id", USER]);
    }
  });
});

describe("sendFinishTripEmail: what it sends", () => {
  it("sends one opt-out-gated email in the account's language with the destination prefilled", async () => {
    const { svc } = fakeSvc({ paths: ["/es/trips/new", "/es"], destinations: ["Lisboa", "lisboa"] });
    expect(await sendFinishTripEmail(svc, ROW, translatorFor)).toEqual({ status: "sent", reason: "sent" });

    expect(dispatchEmail).toHaveBeenCalledTimes(1);
    const call = dispatchEmail.mock.calls[0][0];
    expect(call).toMatchObject({
      recipientEmail: "traveller@example.com",
      recipientUserId: USER,
      idempotencyKey: `finish_trip:${USER}`,
      locale: "es",
      metadata: { scheduled_notification_id: "row-1", slot: FINISH_TRIP_SLOT },
    });
    expect(call.template.id).toBe("finish_trip");
    expect(call.template.props).toMatchObject({
      heading: "Tu viaje a Lisboa está a un paso",
      ctaUrl: "https://monkeytravel.app/es/trips/new?slot=finish_trip_1d&destination=Lisboa",
      signoff: "El equipo de MonkeyTravel",
    });

    // The send-time gate accepts the real rendered email.
    const html = await render(FinishTripEmail(call.template.props));
    expect(call.verify({ html, text: "", subject: finishTripSubject(call.template.props) })).toEqual({ ok: true });
  });

  it("names no place when step 1 does not clearly give one, and the gate still passes", async () => {
    const { svc } = fakeSvc({ destinations: ["Rome", "Milan"] });
    await sendFinishTripEmail(svc, ROW, translatorFor);
    const call = dispatchEmail.mock.calls[0][0];
    expect(call.locale).toBe("en");
    expect(call.template.props.heading).toBe("Your first trip is one step away");
    expect(call.template.props.ctaUrl).toBe("https://monkeytravel.app/trips/new?slot=finish_trip_1d");
    const html = await render(FinishTripEmail(call.template.props));
    expect(call.verify({ html, text: "", subject: call.template.props.heading })).toEqual({ ok: true });
  });

  it("records an opt-out or a bounce as suppressed and a send error as failed", async () => {
    dispatchEmail.mockResolvedValueOnce({ ok: true, status: "skipped_disabled" });
    expect(await sendFinishTripEmail(fakeSvc({}).svc, ROW, translatorFor)).toEqual({
      status: "suppressed",
      reason: "skipped_disabled",
    });
    dispatchEmail.mockResolvedValueOnce({ ok: true, status: "skipped_suppressed" });
    expect((await sendFinishTripEmail(fakeSvc({}).svc, ROW, translatorFor)).reason).toBe("skipped_suppressed");
    dispatchEmail.mockResolvedValueOnce({ ok: false, status: "failed", error: "resend 500" });
    expect(await sendFinishTripEmail(fakeSvc({}).svc, ROW, translatorFor)).toEqual({
      status: "failed",
      reason: "dispatch_error",
      error: "resend 500",
    });
  });

  it("refuses to send copy that fell back to a key path", async () => {
    const keyPaths = async () => ((key: string) => `finishTripEmail.${key}`) as FinishTripTranslator;
    const outcome = await sendFinishTripEmail(fakeSvc({}).svc, ROW, keyPaths);
    expect(outcome).toMatchObject({ status: "failed", reason: "i18n_load_error" });
    expect(dispatchEmail).not.toHaveBeenCalled();
  });
});

describe("finish-trip copy", () => {
  for (const locale of ["en", "es", "it", "pt"]) {
    it(`${locale}: every string resolves and substitutes the destination`, async () => {
      const t = await translatorFor(locale);
      const values = {
        heading: t("heading"),
        headingDestination: t("headingDestination", { destination: "Kyoto" }),
        body: t("body"),
        bodyDestination: t("bodyDestination", { destination: "Kyoto" }),
        cta: t("cta"),
        signoff: t("signoff"),
      };
      for (const [key, value] of Object.entries(values)) {
        expect(value, `${locale}/${key}`).not.toContain("finishTripEmail.");
        expect(value, `${locale}/${key}`).not.toContain("{destination}");
        expect(value.trim().length, `${locale}/${key}`).toBeGreaterThan(0);
      }
      expect(values.headingDestination).toContain("Kyoto");
      expect(values.bodyDestination).toContain("Kyoto");
      expect(values.signoff).toContain("MonkeyTravel");
    });
  }
});

describe("rollout", () => {
  const dir = join(ROOT, "supabase", "migrations");
  const file = readdirSync(dir).find((name) => name.endsWith("_finish_trip_email.sql"));
  const sql = readFileSync(join(dir, file ?? ""), "utf8").toLowerCase();

  it("queues new accounts from a trigger and never backfills existing ones", () => {
    expect(sql).toContain("after insert on public.users");
    expect(sql.match(/insert into scheduled_notifications/g)).toHaveLength(1);
    expect(sql).not.toMatch(/insert into scheduled_notifications[^;]*select/);
  });

  it("the cron routes the account-level slot to finish-trip", () => {
    const route = readFileSync(join(ROOT, "app", "api", "cron", "scheduled-notifications", "route.ts"), "utf8");
    expect(route).toContain("row.slot === FINISH_TRIP_SLOT");
    expect(route).toContain("namespace: FINISH_TRIP_NS");
  });
});
