import { describe, it, expect } from "vitest";
import {
  carryTypeHint,
  curatedFor,
  readActivityTypeHint,
  withActivityTypeHint,
} from "@/lib/images/activity";

/**
 * The `t=` type hint exists so that when a Google place photo dies permanently,
 * /api/places/photo can redirect to a stock image that MATCHES the activity
 * instead of generic scenery — a dinner reservation was rendering a mountain.
 *
 * The hint travels in the proxy URL because that URL is what gets frozen into
 * `trips.itinerary` JSONB; by the time the browser requests the image, the
 * activity that owns it is long out of scope. That makes these tests the only
 * thing standing between the feature and a silent regression: nothing about a
 * dropped `t=` param is visible until a photo dies months later.
 */

const PROXY = "/api/places/photo?name=places%2FChIJ123%2Fphotos%2FAbC&w=600&h=400";

describe("withActivityTypeHint", () => {
  it("tags our proxy URL", () => {
    expect(withActivityTypeHint(PROXY, "restaurant")).toBe(`${PROXY}&t=restaurant`);
  });

  it("lowercases the type so the reader's charset check passes", () => {
    expect(withActivityTypeHint(PROXY, "Restaurant")).toBe(`${PROXY}&t=restaurant`);
  });

  it("keeps multi-word type keys, which are real (nature_attraction)", () => {
    expect(withActivityTypeHint(PROXY, "nature_attraction")).toBe(
      `${PROXY}&t=nature_attraction`
    );
  });

  it("leaves curated Pexels URLs alone — they are already final", () => {
    const pexels = "https://images.pexels.com/photos/154145/pexels-photo-154145.jpeg";
    expect(withActivityTypeHint(pexels, "food")).toBe(pexels);
  });

  it("never double-appends when an itinerary is re-enriched", () => {
    const once = withActivityTypeHint(PROXY, "restaurant");
    expect(withActivityTypeHint(once, "spa")).toBe(once);
  });

  it("drops a malformed type rather than encoding it into the URL", () => {
    expect(withActivityTypeHint(PROXY, "resto & bar")).toBe(PROXY);
    expect(withActivityTypeHint(PROXY, "")).toBe(PROXY);
    expect(withActivityTypeHint(PROXY, "x".repeat(64))).toBe(PROXY);
  });
});

describe("readActivityTypeHint", () => {
  it("round-trips a tagged URL", () => {
    const url = new URL(
      withActivityTypeHint(PROXY, "nightlife"),
      "https://monkeytravel.app"
    );
    expect(readActivityTypeHint(url.searchParams.get("t"))).toBe("nightlife");
  });

  it("returns '' for absent or junk hints instead of throwing", () => {
    // Every itinerary URL written before 2026-08-04 hits this path.
    expect(readActivityTypeHint(null)).toBe("");
    expect(readActivityTypeHint(undefined)).toBe("");
    expect(readActivityTypeHint("../../etc/passwd")).toBe("");
    expect(readActivityTypeHint("food; DROP TABLE")).toBe("");
  });
});

describe("curatedFor", () => {
  const NAME = "Osteria da Fortunata";

  it("is deterministic — the CDN caches one redirect target per broken photo", () => {
    expect(curatedFor(NAME, "restaurant")).toBe(curatedFor(NAME, "restaurant"));
  });

  it("actually uses the type: same activity name, different type, different image", () => {
    // This is the whole point of the change. Before it, both sides of this
    // assertion came from one 6-image list picked without knowing the type.
    const asRestaurant = curatedFor(NAME, "restaurant");
    const asSpa = curatedFor(NAME, "spa");
    const asTransport = curatedFor(NAME, "transport");
    expect(new Set([asRestaurant, asSpa, asTransport]).size).toBe(3);
  });

  it("falls back to generic scenery for an unknown type instead of throwing", () => {
    const url = curatedFor(NAME, "some_type_nobody_curated_yet");
    expect(url).toMatch(/^https:\/\/images\.pexels\.com\/photos\/\d+\//);
  });

  it("treats a missing type as 'attraction' (the pre-hint behaviour)", () => {
    expect(curatedFor(NAME, "")).toBe(curatedFor(NAME, "attraction"));
  });

  it("spreads a trip's activities across the pool rather than repeating one image", () => {
    const dinners = [
      "Trattoria da Enzo",
      "Osteria Mario",
      "Pizzeria ai Marmi",
      "Roscioli",
      "Da Danilo",
      "Armando al Pantheon",
    ];
    const picks = new Set(dinners.map((n) => curatedFor(n, "restaurant")));
    // 6 names drawn from an 11-image pool; random assignment expects ~4.6
    // distinct. Anything at or below 2 means the selector has collapsed.
    expect(picks.size).toBeGreaterThanOrEqual(3);
  });
});

describe("the full chain the proxy actually walks", () => {
  /**
   * tag at resolve time → freeze into itinerary JSONB → months later the Google
   * photo 4xxes → /api/places/photo reads the hint back and redirects. This is
   * the property that was broken: the last step had no idea what the activity
   * was. Asserted as one composition because every link is in a different file
   * and each individually passing proves nothing about the whole.
   */
  function resolveFallback(storedUrl: string, name: string): string {
    const parsed = new URL(storedUrl, "https://monkeytravel.app");
    return curatedFor(name, readActivityTypeHint(parsed.searchParams.get("t")));
  }

  it("lands a restaurant on a restaurant image and a spa on a spa image", () => {
    const name = "Casa Lucio";
    const untagged = resolveFallback(PROXY, name);
    const asRestaurant = resolveFallback(withActivityTypeHint(PROXY, "restaurant"), name);
    const asSpa = resolveFallback(withActivityTypeHint(PROXY, "spa"), name);

    expect(asRestaurant).not.toBe(untagged);
    expect(asSpa).not.toBe(untagged);
    expect(asRestaurant).not.toBe(asSpa);
  });

  it("survives a refresh through places_v2", () => {
    const name = "Casa Lucio";
    const stored = withActivityTypeHint(PROXY, "restaurant");
    // places_v2 hands back a canonical URL with no hint on it.
    const refreshed = carryTypeHint(stored, "/api/places/photo?name=places%2FnewId%2Fphotos%2FnewTok&w=600&h=400");
    expect(resolveFallback(refreshed, name)).toBe(resolveFallback(stored, name));
  });
});

describe("carryTypeHint", () => {
  const FRESH = "/api/places/photo?name=places%2FChIJ999%2Fphotos%2FXyZ&w=600&h=400";

  it("moves the hint onto a refreshed URL", () => {
    // places_v2.photo_url is cached per PLACE and carries no hint, so without
    // this the refresher silently downgrades every tagged activity.
    expect(carryTypeHint(`${PROXY}&t=museum`, FRESH)).toBe(`${FRESH}&t=museum`);
  });

  it("leaves an untagged URL untagged", () => {
    expect(carryTypeHint(PROXY, FRESH)).toBe(FRESH);
  });

  it("does not overwrite a hint the replacement already carries", () => {
    expect(carryTypeHint(`${PROXY}&t=museum`, `${FRESH}&t=park`)).toBe(
      `${FRESH}&t=park`
    );
  });

  it("ignores a malformed hint on the old URL", () => {
    expect(carryTypeHint(`${PROXY}&t=NOT VALID`, FRESH)).toBe(FRESH);
  });

  it("handles a missing old URL", () => {
    expect(carryTypeHint(null, FRESH)).toBe(FRESH);
    expect(carryTypeHint(undefined, FRESH)).toBe(FRESH);
  });

  it("leaves non-proxy replacements alone", () => {
    const pexels = "https://images.pexels.com/photos/154145/pexels-photo-154145.jpeg";
    expect(carryTypeHint(`${PROXY}&t=museum`, pexels)).toBe(pexels);
  });
});
