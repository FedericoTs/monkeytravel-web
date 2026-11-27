// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

/**
 * The story page around the story: which trip a link opens, whose opening counts as a visit, who is
 * shown their own link, and what the link's preview may say before the guess is answered.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";

const ROW = {
  id: "trip-1",
  user_id: "owner-1" as string | null,
  claim_token: null as string | null,
  title: "Lisbon Trip",
  trip_meta: { destination: "Lisbon, Portugal", timezone: "Europe/Lisbon" },
  start_date: "2027-01-09",
  end_date: "2027-01-10",
  itinerary: [
    { day_number: 1, date: "2027-01-09", title: "Alfama", activities: [{ name: "Sé de Lisboa", type: "landmark", coordinates: { lat: 38.7098, lng: -9.1326 } }] },
    { day_number: 2, date: "2027-01-10", title: "Belém", activities: [{ name: "Belém Tower", type: "landmark", coordinates: { lat: 38.6916, lng: -9.216 } }] },
  ],
};

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  refused: false,
  asked: [] as Array<{ column: string; value: unknown }>,
  selected: [] as string[],
  viewer: null as string | null,
  madeLink: false,
  headers: {} as Record<string, string>,
}));
const spies = vi.hoisted(() => ({
  logSharedTripVisit: vi.fn(async () => {}),
  madeThisShareLink: vi.fn(async () => state.madeLink),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q = {
        select: (cols: string) => {
          state.selected.push(cols);
          return q;
        },
        eq: (column: string, value: unknown) => {
          state.asked.push({ column, value });
          return q;
        },
        is: () => q,
        maybeSingle: async () =>
          state.refused ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } : { data: state.row, error: null },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ signedInUserId: async () => state.viewer }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => state.headers[name] ?? null }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (work: Promise<unknown>) => void work }));
vi.mock("@/lib/analytics/funnel-events", () => ({
  logSharedTripVisit: spies.logSharedTripVisit,
  madeThisShareLink: spies.madeThisShareLink,
}));
vi.mock("@/components/story/TripStoryView", () => ({ default: function TripStoryView() { return null; } }));

const { default: TripStoryPage, generateMetadata } = await import("./page");

const params = (token = TOKEN, locale = "en") => Promise.resolve({ locale, token });
const BROWSER = { "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36", "sec-fetch-dest": "document" };

async function viewProps(token = TOKEN, locale = "en"): Promise<Record<string, unknown>> {
  const element = (await TripStoryPage({ params: params(token, locale) })) as ReactElement<Record<string, unknown>>;
  expect(isValidElement(element)).toBe(true);
  return element.props;
}

beforeEach(() => {
  state.row = { ...ROW };
  state.refused = false;
  state.asked = [];
  state.selected = [];
  state.viewer = null;
  state.madeLink = false;
  state.headers = { ...BROWSER };
  spies.logSharedTripVisit.mockClear();
  spies.madeThisShareLink.mockClear();
});

describe("the trip a story link opens", () => {
  it("is the one its share token names, read without the columns a story doesn't tell", async () => {
    const props = await viewProps();
    expect(state.asked).toContainEqual({ column: "share_token", value: TOKEN });
    expect(state.selected[0]).not.toMatch(/\*|share_token|budget|packing|cover/);
    expect(props.tripId).toBe("trip-1");
    expect(props.story).toMatchObject({ place: "Lisbon", dayCount: 2 });
    expect(props.fullPlanHref).toBe(`/shared/${TOKEN}`);
    expect(props.storyUrl).toBe(`https://monkeytravel.app/shared/${TOKEN}/story`);
    expect(props.shareToken).toBe(TOKEN);
    expect(props.planHref).toBe("/trips/new?destination=Lisbon&days=2&from=trip");
  });

  it("carries the reader's language into the link to pass on, and names the place in it", async () => {
    const props = await viewProps(TOKEN, "it");
    expect(props.storyUrl).toBe(`https://monkeytravel.app/it/shared/${TOKEN}/story`);
    expect(props.story).toMatchObject({ place: "Lisbona" });
    expect(props.planHref).toBe("/trips/new?destination=Lisbona&days=2&from=trip");
  });

  it("is not found for a token that names no trip, or that is no token, without asking the database for the second", async () => {
    state.row = null;
    await expect(TripStoryPage({ params: params() })).rejects.toThrow("notFound");
    state.asked = [];
    await expect(TripStoryPage({ params: params("not-a-token") })).rejects.toThrow("notFound");
    expect(state.asked).toEqual([]);
  });

  it("is an error, not a missing trip, when the database refuses the read", async () => {
    state.refused = true;
    await expect(TripStoryPage({ params: params() })).rejects.toMatchObject({ code: "57014" });
    await expect(generateMetadata({ params: params() })).rejects.toMatchObject({ code: "57014" });
  });
});

describe("whose opening counts", () => {
  it("counts a friend's as a visit to the share link, marked as a story", async () => {
    const props = await viewProps();
    expect(spies.logSharedTripVisit).toHaveBeenCalledWith("trip-1", { crewAsk: false, story: true });
    expect(props.mine).toBe(false);
  });

  it("doesn't count the owner's, and shows them their link", async () => {
    state.viewer = "owner-1";
    const props = await viewProps();
    expect(spies.logSharedTripVisit).not.toHaveBeenCalled();
    expect(props.mine).toBe(true);
  });

  it("doesn't count the browser that made a signed-out link, and shows it its link", async () => {
    state.row = { ...ROW, user_id: null, claim_token: "claim" };
    state.madeLink = true;
    const props = await viewProps();
    expect(spies.madeThisShareLink).toHaveBeenCalledWith("trip-1");
    expect(spies.logSharedTripVisit).not.toHaveBeenCalled();
    expect(props.mine).toBe(true);
  });

  it("counts a friend of a signed-out link's maker", async () => {
    state.row = { ...ROW, user_id: null, claim_token: "claim" };
    const props = await viewProps();
    expect(spies.logSharedTripVisit).toHaveBeenCalledTimes(1);
    expect(props.mine).toBe(false);
  });

  it("asks who made the link only of a trip with no owner", async () => {
    await viewProps();
    expect(spies.madeThisShareLink).not.toHaveBeenCalled();
  });

  it("doesn't count a chat app fetching the preview, a prefetch, or a trip nobody shared", async () => {
    state.headers = { "user-agent": "WhatsApp/2.23.20.0", "sec-fetch-dest": "document" };
    await viewProps();
    state.headers = { ...BROWSER, purpose: "prefetch" };
    await viewProps();
    state.headers = { ...BROWSER };
    state.row = { ...ROW, user_id: null, claim_token: null };
    await viewProps();
    expect(spies.logSharedTripVisit).not.toHaveBeenCalled();
  });
});

describe("the link's preview", () => {
  it("keeps the place out of a story that opens on a guess", async () => {
    const meta = await generateMetadata({ params: params() });
    expect(meta.title).toBe("metaTitleGuess");
    expect(JSON.stringify(meta)).not.toMatch(/lisbon/i);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("names a trip that asks no guess", async () => {
    state.row = { ...ROW, trip_meta: { destination: "San Marco Argentano and Fuscaldo, Calabria" } };
    const meta = await generateMetadata({ params: params() });
    expect(meta.title).toBe('metaTitle {"place":"San Marco Argentano and Fuscaldo"}');
  });

  it("says a missing trip is unavailable, and keeps it out of search", async () => {
    state.row = null;
    const meta = await generateMetadata({ params: params() });
    expect(meta.title).toBe("unavailable.metaTitle");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
