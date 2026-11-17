// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeSupabase } from "@/tests/fake-supabase";
import { signDayLink, verifyDayLink } from "@/lib/trips/day-link";

/**
 * The page a trip email's link opens shows one day, without sign-in. On a trip
 * of several days the traveller has to be able to read the other days from
 * there too: a page that shows "Day 1" and nothing else passes for the whole
 * plan, with the rest of it apparently gone.
 */

// Generated per run: no key-shaped literal in the source.
const SECRET = randomBytes(32).toString("hex");
const TRIP = "11111111-2222-4333-8444-555555555555";
let trip: Record<string, unknown> | null;
let signedIn: boolean;
const db = () => fakeSupabase(() => ({ data: trip, error: null })).client;

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...db(),
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner" } : null } }) },
  }),
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  // The key, with the values it was given.
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  getFormatter: async () => ({ dateTime: () => "Monday" }),
}));
vi.mock("@/components/ActivityCard", () => ({ default: () => null }));
vi.mock("@/components/trip/DayRouteLink", () => ({ DayRouteLink: () => null }));
vi.mock("@/components/trip/SendDayToGroup", () => ({ default: () => null }));

const { default: TripDayPage } = await import("./page");

const stop = (name: string) => ({ name, start_time: "10:00", type: "attraction" });
const tripOf = (start: string, end: string | null, days: number) => ({
  title: "Lisbon Trip",
  start_date: start,
  end_date: end,
  itinerary: Array.from({ length: days }, (_, i) => ({ day_number: i + 1, activities: [stop(`Stop ${i + 1}`)] })),
  budget: null,
});

async function page(date: string, opts: { locale?: string; k?: string } = {}): Promise<string> {
  const element = await TripDayPage({
    params: Promise.resolve({ locale: opts.locale ?? "en", tripId: TRIP, date }),
    searchParams: Promise.resolve({ k: opts.k ?? signDayLink(TRIP, date) }),
  });
  return renderToStaticMarkup(element).replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

/** The row of days: each entry's words, its link (null for the day shown), and whether it is the current one. */
function daysRow(html: string): Array<{ words: string; href: string | null; current: boolean }> {
  const nav = /<nav aria-label="days"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
  if (!nav) return [];
  return [...nav.matchAll(/<(a|span)([^>]*)>([^<]*)<\/\1>/g)].map((m) => ({
    words: m[3],
    href: /href="([^"]+)"/.exec(m[2])?.[1] ?? null,
    current: /aria-current="page"/.test(m[2]),
  }));
}

const keyOf = (href: string) => decodeURIComponent(new URL(href, "https://x.test").searchParams.get("k") ?? "");
const expiryOf = (k: string) => k.split(".")[0];

beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", SECRET);
  vi.useFakeTimers({ toFake: ["Date"] });
  // The evening of day 2 of a 15-18 November trip.
  vi.setSystemTime(Date.UTC(2026, 10, 16, 20));
  trip = tripOf("2026-11-15", "2026-11-18", 4);
  signedIn = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("one day of a trip of several", () => {
  it("says which day of how many it is", async () => {
    expect(await page("2026-11-16")).toContain('headingOf {"day":2,"total":4}');
  });

  it("leads to every other day of the trip, the day shown marked", async () => {
    const row = daysRow(await page("2026-11-16"));
    expect(row.map((d) => d.words)).toEqual(['heading {"day":1}', 'heading {"day":2}', 'heading {"day":3}', 'heading {"day":4}']);
    expect(row.map((d) => d.current)).toEqual([false, true, false, false]);
    expect(row[1].href).toBeNull();
    expect(row.filter((d) => !d.current).map((d) => d.href?.split("?")[0])).toEqual([
      `/day/${TRIP}/2026-11-15`,
      `/day/${TRIP}/2026-11-17`,
      `/day/${TRIP}/2026-11-18`,
    ]);
  });

  it("opens each of them without sign-in, and only that day", async () => {
    const row = daysRow(await page("2026-11-16"));
    for (const [href, date] of [
      [row[0].href!, "2026-11-15"],
      [row[2].href!, "2026-11-17"],
      [row[3].href!, "2026-11-18"],
    ]) {
      expect(verifyDayLink(TRIP, date, keyOf(href))).toEqual({ ok: true });
      expect(verifyDayLink(TRIP, "2026-11-16", keyOf(href)).ok).toBe(false);
    }
  });

  it("never makes a link last longer than the one that opened the page", async () => {
    const opened = signDayLink(TRIP, "2026-11-16");
    const row = daysRow(await page("2026-11-16", { k: opened }));
    for (const d of row.filter((d) => !d.current)) expect(expiryOf(keyOf(d.href!))).toBe(expiryOf(opened));
    // Day 4's own email link would last until the 20th; reached from day 2's page it ends with day 2's link.
    vi.setSystemTime(Number(expiryOf(opened)) * 1000 + 1000);
    expect(verifyDayLink(TRIP, "2026-11-18", keyOf(row[3].href!))).toEqual({ ok: false, reason: "expired" });
  });

  it("keeps the page's language in the links", async () => {
    const links = daysRow(await page("2026-11-16", { locale: "es" })).flatMap((d) => (d.href ? [d.href] : []));
    expect(links).toHaveLength(3);
    for (const href of links) expect(href.startsWith(`/es/day/${TRIP}/`)).toBe(true);
  });

  it("counts the trip's days from its dates, not from the days the plan holds", async () => {
    trip = tripOf("2026-11-15", "2026-11-19", 3);
    const html = await page("2026-11-15");
    expect(html).toContain('headingOf {"day":1,"total":5}');
    expect(daysRow(html)).toHaveLength(5);
  });

  it("still sends a visitor to sign in to edit, and the owner to the trip", async () => {
    expect(await page("2026-11-16")).toContain(`/auth/login?redirect=${encodeURIComponent(`/trips/${TRIP}`)}`);
    signedIn = true;
    const html = await page("2026-11-16");
    expect(html).toContain(`href="/trips/${TRIP}"`);
    expect(html).toContain("openTrip");
  });
});

describe("a link that no longer works", () => {
  it("opens no day, and no row of days", async () => {
    const opened = signDayLink(TRIP, "2026-11-15");
    vi.setSystemTime(Number(expiryOf(opened)) * 1000 + 1000);
    const html = await page("2026-11-15", { k: opened });
    expect(html).toContain("expiredTitle");
    expect(daysRow(html)).toEqual([]);
  });
});

describe("a one-day trip", () => {
  it("keeps the plain heading, with no row of days", async () => {
    trip = tripOf("2026-11-16", "2026-11-16", 1);
    const html = await page("2026-11-16");
    expect(html).toContain('heading {"day":1}');
    expect(html).not.toContain("headingOf");
    expect(daysRow(html)).toEqual([]);
  });

  it("counts a trip with no end date as one day", async () => {
    trip = tripOf("2026-11-16", null, 1);
    const html = await page("2026-11-16");
    expect(html).toContain('heading {"day":1}');
    expect(daysRow(html)).toEqual([]);
  });
});

describe("the words in every language", () => {
  it.each(["en", "es", "it", "pt"])("%s", async (locale) => {
    const messages = (await import(`../../../../../../messages/${locale}/common.json`)).default as {
      tripDayPage: Record<string, string>;
    };
    const words = messages.tripDayPage;
    expect(words.headingOf).toContain("{day}");
    expect(words.headingOf).toContain("{total}");
    expect(words.days?.trim()).toBeTruthy();
  });
});
