// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * The page a trip email's link opens shows one day, without sign-in. A
 * traveller on a trip of several days has to be told that, and where the other
 * days are: a page that says only "Day 1" passes for the whole plan.
 */

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
vi.mock("@/lib/trips/day-link", async (original) => ({
  ...(await original<typeof import("@/lib/trips/day-link")>()),
  verifyDayLink: () => ({ ok: true }),
}));
vi.mock("@/components/ActivityCard", () => ({ default: () => null }));
vi.mock("@/components/trip/DayRouteLink", () => ({ DayRouteLink: () => null }));
vi.mock("@/components/trip/SendDayToGroup", () => ({ default: () => null }));

const { default: TripDayPage } = await import("./page");

const stop = (name: string) => ({ name, start_time: "10:00", type: "attraction" });
const tripOf = (start: string, end: string, days: number) => ({
  title: "Broken Bow Trip",
  start_date: start,
  end_date: end,
  itinerary: Array.from({ length: days }, (_, i) => ({ day_number: i + 1, activities: [stop(`Stop ${i + 1}`)] })),
  budget: null,
});

async function page(date: string): Promise<string> {
  const element = await TripDayPage({
    params: Promise.resolve({ locale: "en", tripId: TRIP, date }),
    searchParams: Promise.resolve({ k: "key" }),
  });
  return renderToStaticMarkup(element).replaceAll("&quot;", '"');
}

const loginToTrip = `/auth/login?redirect=${encodeURIComponent(`/trips/${TRIP}`)}`;

beforeEach(() => {
  trip = tripOf("2026-11-15", "2026-11-18", 4);
  signedIn = false;
});

describe("one day of a trip of several", () => {
  it("says which day of how many it is", async () => {
    const html = await page("2026-11-16");
    expect(html).toContain('headingOf {"day":2,"total":4}');
    expect(html).toContain('readOnlyOf {"total":4}');
  });

  it("offers the whole trip at the top and the bottom, through sign-in when signed out", async () => {
    const html = await page("2026-11-15");
    const links = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1].replaceAll("&amp;", "&"), m[2]]);
    expect(links).toEqual([
      [loginToTrip, 'signInToSeeAll {"total":4}'],
      [loginToTrip, 'signInToSeeAll {"total":4}'],
    ]);
    expect(html).not.toContain("signInToEdit");
  });

  it("goes straight to the trip when signed in", async () => {
    signedIn = true;
    const html = await page("2026-11-18");
    expect(html).toContain('headingOf {"day":4,"total":4}');
    expect(html).toContain(`<a href="/trips/${TRIP}"`);
    expect(html).toContain('seeAllDays {"total":4}');
    expect(html).toContain("openTrip");
    expect(html).not.toContain("signInToSeeAll");
  });

  it("counts the trip's days from its dates, not from the days the plan holds", async () => {
    trip = tripOf("2026-11-15", "2026-11-19", 3);
    expect(await page("2026-11-15")).toContain('headingOf {"day":1,"total":5}');
  });
});

describe("a one-day trip", () => {
  it("keeps the plain words: there is nothing else to see", async () => {
    trip = tripOf("2026-11-15", "2026-11-15", 1);
    const html = await page("2026-11-15");
    expect(html).toContain('heading {"day":1}');
    expect(html).toContain("readOnly");
    expect(html).toContain("signInToEdit");
    expect(html).not.toContain("total");
  });

  it("counts a trip with no end date as one day", async () => {
    trip = { ...tripOf("2026-11-15", "2026-11-15", 1), end_date: null };
    const html = await page("2026-11-15");
    expect(html).toContain('heading {"day":1}');
    expect(html).not.toContain("total");
  });
});

describe("the words in every language", () => {
  it.each(["en", "es", "it", "pt"])("%s", async (locale) => {
    const messages = (await import(`../../../../../../messages/${locale}/common.json`)).default as {
      tripDayPage: Record<string, string>;
    };
    const words = messages.tripDayPage;
    expect(words.headingOf).toContain("{day}");
    for (const key of ["headingOf", "readOnlyOf", "seeAllDays", "signInToSeeAll"]) {
      expect(words[key], `${locale} ${key}`).toContain("{total}");
    }
  });
});
