// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * A trip's link preview. A rendered card is cached for a day under the trip's tag,
 * so the routes that end its link can drop it (lib/seo/trip-card-cache). Anything
 * else gets the brand card, for minutes, since the key may start working later. A
 * slug only names a published trip that isn't hidden. The real route runs up to the
 * image drawing.
 */

const s = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  readError: null as unknown,
  jpegFails: false,
  log: [] as unknown[],
  // What the trip card was drawn with.
  card: null as { budget: string | null; cover: string | null; coverCredit?: { author: string; license: string } | null } | null,
  // What a story's picture was drawn with, and at what size.
  slide: null as { format: string; place: string; guess: unknown; clues: number } | null,
  size: null as { width?: number; height?: number } | null,
}));

vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(_element: unknown, options: { headers: Record<string, string>; width?: number; height?: number }) {
      super("png", { headers: { "Content-Type": "image/png", ...options.headers } });
      s.size = { width: options.width, height: options.height };
    }
  },
}));
vi.mock("@/lib/og/fonts", () => ({ cardFonts: async () => [] }));
vi.mock("@/lib/og/trip-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/og/trip-card")>();
  return {
    ...real,
    renderTripCard: (d: Parameters<typeof real.renderTripCard>[0], format: Parameters<typeof real.renderTripCard>[1]) => {
      s.card = d;
      return real.renderTripCard(d, format);
    },
  };
});
vi.mock("@/lib/og/story-slides", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/og/story-slides")>();
  return {
    ...real,
    renderStorySlide: (...args: Parameters<typeof real.renderStorySlide>) => {
      const [format, story, words] = args;
      s.slide = { format, place: story.place, guess: story.guess, clues: words.clues.length };
      return real.renderStorySlide(...args);
    },
  };
});
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
vi.mock("@/lib/og/link-card-jpeg", () => ({
  linkCardJpeg: async () => {
    if (s.jpegFails) throw new Error("no jpeg");
    return Buffer.from("jpeg");
  },
}));
vi.mock("@/lib/analytics/telemetry-env", () => ({ writesTelemetry: () => false }));
vi.mock("@/lib/analytics/funnel-events", () => ({ logFunnelEventServer: async () => {} }));
vi.mock("@/lib/seo/trip-card-cache", () => ({ tripCardTag: (id: string) => `trip-card-${id}` }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q) =>
      q.table === "trips" ? { data: s.row, error: s.readError } : { data: null, error: null, count: 2 }
    );
    s.log = db.log;
    return db.client;
  },
}));

const { GET } = await import("./route");

const TOKEN = crypto.randomUUID();
const SLUG = "lisbon-trip-abc123";
const TRIP = {
  id: "trip-1",
  title: "Lisbon Trip",
  trip_meta: { destination: "Lisbon, Portugal" },
  start_date: "2027-05-10",
  end_date: "2027-05-12",
  cover_image_url: null,
  itinerary: [{ day_number: 1, activities: [{ name: "Alfama" }] }],
  budget: null,
  is_hidden: false,
};

const card = (query: string) => GET(new NextRequest(`https://monkeytravel.app/api/og/trip?${query}`));
const tripRead = () => (s.log as FakeQuery[]).find((q) => q.table === "trips");
const expectBrandCard = (res: Response) => {
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  expect(res.headers.get("Vercel-Cache-Tag")).toBeNull();
};
const expectTripCard = (res: Response) => {
  expect(res.headers.get("Cache-Control")).toContain("s-maxage=86400");
  expect(res.headers.get("Vercel-Cache-Tag")).toBe("trip-card-trip-1");
};

beforeEach(() => {
  s.row = TRIP;
  s.readError = null;
  s.jpegFails = false;
  s.log = [];
  s.card = null;
  s.slide = null;
  s.size = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a trip's card", () => {
  it("by its share link is tagged with the trip, for a day", async () => {
    const res = await card(`token=${TOKEN}`);
    expectTripCard(res);
    expect(tripRead()?.filters).toEqual(
      expect.arrayContaining([
        ["eq", "share_token", TOKEN],
        ["is", "deleted_at", null],
      ])
    );
  });

  it("by its slug only names a published trip", async () => {
    expectTripCard(await card(`slug=${SLUG}`));
    expect(tripRead()?.filters).toEqual(
      expect.arrayContaining([
        ["eq", "public_slug", SLUG],
        ["eq", "visibility", "public"],
        ["is", "deleted_at", null],
      ])
    );
  });

  it("of a hidden trip isn't given by its slug, but is by its share link", async () => {
    s.row = { ...TRIP, is_hidden: true };
    expectBrandCard(await card(`slug=${SLUG}`));
    expectTripCard(await card(`token=${TOKEN}`));
  });

  it("is a JPEG for a link preview, and the PNG when that fails", async () => {
    expect((await card(`token=${TOKEN}`)).headers.get("Content-Type")).toBe("image/jpeg");
    s.jpegFails = true;
    const res = await card(`token=${TOKEN}`);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expectTripCard(res);
  });

  // The estimate saved with the plan never moves after a change; the page adds up its stops.
  it("draws the trip's cover only when it may leave the site, with the credit a Commons photo asks for", async () => {
    s.row = { ...TRIP, cover_image_url: "/api/images/wikimedia/abc123-1280.jpg?a=Yann+Caradec&l=CC+BY-SA+2.0&f=Tour+Eiffel.jpg" };
    await card(`token=${TOKEN}`);
    expect(s.card?.cover).toBe("https://monkeytravel.app/api/images/wikimedia/abc123-1280.jpg?a=Yann+Caradec&l=CC+BY-SA+2.0&f=Tour+Eiffel.jpg");
    expect(s.card?.coverCredit).toEqual({ author: "Yann Caradec", license: "CC BY-SA 2.0" });

    // A Google photo stays on the site: the card is drawn without it.
    s.row = { ...TRIP, cover_image_url: "/api/places/photo?name=places%2Fabc&w=600&h=400" };
    await card(`token=${TOKEN}&format=story`);
    expect(s.card?.cover).toBeNull();
    expect(s.card?.coverCredit).toBeNull();

    s.row = { ...TRIP, cover_image_url: "https://images.pexels.com/photos/1/p.jpeg" };
    await card(`token=${TOKEN}`);
    expect(s.card?.cover).toBe("https://images.pexels.com/photos/1/p.jpeg?w=1200&h=1200&fit=crop");
    expect(s.card?.coverCredit).toBeNull();
  });

  it("prices the trip as its page does: the stops added up, per person, never the estimate saved with it", async () => {
    s.row = {
      ...TRIP,
      budget: { total: 4503, currency: "USD" },
      itinerary: [
        {
          day_number: 1,
          activities: [
            { name: "Alfama", estimated_cost: { amount: 30, currency: "USD" } },
            { name: "Fado dinner", estimated_cost: { amount: 20, currency: "USD" } },
          ],
        },
      ],
    };
    await card(`token=${TOKEN}`);
    expect(s.card?.budget).toBe("50 USD per person");
    await card(`token=${TOKEN}&locale=pt`);
    expect(s.card?.budget).toBe("50 USD por pessoa");
  });

  it.each(["square", "story"])("stays a PNG as the %s people save and post", async (format) => {
    const res = await card(`token=${TOKEN}&format=${format}`);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expectTripCard(res);
  });
});

describe("a story's pictures to post", () => {
  it.each(["guess", "place"] as const)("draws the %s for a share link, story-sized, kept like the trip's cards", async (format) => {
    const res = await card(`token=${TOKEN}&format=${format}&locale=it`);
    expectTripCard(res);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(s.size).toEqual({ width: 1080, height: 1920 });
    // The story of that link, in the language asked for.
    expect(s.slide).toMatchObject({ format, place: "Lisbona" });
    expect(s.slide?.clues).toBeGreaterThan(0);
    expect(s.card).toBeNull();
    expect(tripRead()?.filters).toEqual(expect.arrayContaining([["eq", "share_token", TOKEN]]));
  });

  it("belong to the share link: a public trip's address gets its card, not a picture", async () => {
    const res = await card(`slug=${SLUG}&format=guess`);
    expectTripCard(res);
    expect(s.slide).toBeNull();
    expect(s.card).not.toBeNull();
  });

  it("are the trip's place for a story that asks no guess", async () => {
    s.row = {
      ...TRIP,
      trip_meta: { destination: "Lisbon & Porto" },
      itinerary: [
        { day_number: 1, city: "Lisbon", activities: [{ name: "Alfama" }] },
        { day_number: 2, city: "Porto", activities: [{ name: "Ribeira" }] },
      ],
    };
    expectTripCard(await card(`token=${TOKEN}&format=guess`));
    expect(s.slide).toMatchObject({ format: "guess", place: "Lisbon & Porto", guess: null, clues: 0 });
  });

  it("are the brand card for a link that finds no trip", async () => {
    s.row = null;
    expectBrandCard(await card(`token=${TOKEN}&format=guess`));
    expect(s.slide).toBeNull();
  });
});

describe("the brand card, for minutes", () => {
  it.each([
    ["no key", "x=1"],
    ["a token that isn't one", "token=nope"],
    ["a slug that isn't one", "slug=../../etc"],
  ])("answers %s, without reading", async (_name, query) => {
    expectBrandCard(await card(query));
    expect(tripRead()).toBeUndefined();
  });

  it("answers a key that finds nothing, or a read that fails", async () => {
    s.row = null;
    expectBrandCard(await card(`token=${TOKEN}`));
    s.row = TRIP;
    s.readError = { message: "read failed" };
    expectBrandCard(await card(`token=${TOKEN}`));
  });
});
