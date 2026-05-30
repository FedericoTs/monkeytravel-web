/**
 * UK FCDO (Foreign, Commonwealth & Development Office) travel-advice client.
 *
 * The FCDO publishes country-specific travel advice via the gov.uk
 * Content API at https://www.gov.uk/api/content/foreign-travel-advice/{slug}.
 * It's free, unauthenticated, updated daily, and covers ~230 countries.
 * We pull the description + alert level and surface it on the trip page
 * so the user sees the official UK position on travel safety alongside
 * the AI's itinerary.
 *
 * (Earlier draft used /api/world/{slug}/travel-advice — that endpoint
 * 404s; verified live via curl against gov.uk on 2026-05-30 that the
 * Content API path above is the right one.)
 *
 * Why FCDO and not just State Dept?
 *   - Open API, no key, no rate limit (within reason)
 *   - Daily updates by professional analysts
 *   - Most actionable signal: "avoid all travel" / "avoid all but essential
 *     travel" / specific regions to avoid — directly tied to safety
 *   - We can layer State Dept later (task #222 follow-up) — the
 *     normalized `TravelAdvisory` shape leaves room for sourceState too.
 *
 * Cache strategy: in-process Map with a 6h TTL. The FCDO advice doesn't
 * change minute-to-minute; we're protecting against per-request hammering
 * + giving us latency control. The cache is per-Vercel-instance, so a
 * cold serverless invocation re-fetches — that's fine, 1 fetch per 6h
 * per cold instance is well within FCDO's tolerance.
 */

/** Normalized advisory shape — what the UI consumes. */
export interface TravelAdvisory {
  /** Stable source identifier ("fcdo" today; "state" later). */
  source: "fcdo";
  /** ISO 3166-1 alpha-2 (e.g. "GB") — useful for flagging the source. */
  sourceCountry: "GB";
  /** Country the advisory describes, as returned by the source. */
  countryName: string;
  /** Normalized severity. */
  level: "low" | "advisory" | "high" | "extreme";
  /** Human-readable headline (one sentence). */
  summary: string;
  /** Full advice page on gov.uk — the user's authoritative source. */
  url: string;
  /** ISO timestamp of the underlying advisory's last update. */
  updatedAt: string;
}

interface FcdoApiResponse {
  // The endpoint returns a rich Content API payload; we only read what we need.
  // `description` is the short text shown at the top of the page (~150 chars).
  // `details.alert_status` is an array of canonical alert keys like
  // "avoid_all_travel_to_whole_country" — verified against the live API.
  title?: string;
  base_path?: string;
  description?: string;
  updated_at?: string;
  public_updated_at?: string;
  details?: {
    alert_status?: string[];
    parts?: Array<{ slug?: string; title?: string }>;
  };
}

interface CacheEntry {
  fetchedAt: number;
  advisory: TravelAdvisory | null;
}

const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Map FCDO `alert_status` flags → our 4-level scale.
 *
 * FCDO uses canonical strings in the alert_status array — verified live:
 *   avoid_all_travel_to_whole_country         → extreme
 *   avoid_all_travel_to_parts                 → high (partial extreme)
 *   avoid_all_but_essential_travel_to_whole_country → high
 *   avoid_all_but_essential_travel_to_parts   → advisory
 *   (anything else present)                   → advisory
 *   (empty array)                             → low
 *
 * Order matters: we check the most severe predicates first, return on
 * first match. The substring tests survive new sub-variants FCDO adds.
 */
function deriveLevel(
  alertStatus: string[] | undefined,
  description: string
): TravelAdvisory["level"] {
  const tags = (alertStatus ?? []).map((s) => s.toLowerCase());
  if (tags.some((t) => t === "avoid_all_travel_to_whole_country")) {
    return "extreme";
  }
  if (
    tags.some(
      (t) =>
        t === "avoid_all_travel_to_parts" ||
        t === "avoid_all_but_essential_travel_to_whole_country"
    )
  ) {
    return "high";
  }
  if (tags.length > 0) return "advisory";

  // Heuristic fallback — when alert_status is absent the description
  // sometimes surfaces severity in plain text.
  const lower = description.toLowerCase();
  if (lower.includes("avoid all travel")) return "extreme";
  if (lower.includes("avoid all but essential")) return "high";
  if (lower.includes("warning") || lower.includes("alert")) return "advisory";
  return "low";
}

/**
 * Slugify a country name to the format gov.uk uses for its world pages.
 * Examples: "United States" → "usa" (special-case), "Italy" → "italy",
 * "United Arab Emirates" → "united-arab-emirates".
 *
 * The slug list is loose — the API returns 404 for unknown slugs and we
 * cache the null so we don't hammer them. The aliases here cover the
 * common name → slug mismatches; everything else falls through to the
 * default lowercased-hyphenated form.
 */
export function countryNameToFcdoSlug(country: string): string {
  const trimmed = country.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "united states": "usa",
    "united states of america": "usa",
    "us": "usa",
    "usa": "usa",
    "united kingdom": "uk", // FCDO doesn't publish about UK itself but harmless
    "uk": "uk",
    "uae": "united-arab-emirates",
    "drc": "the-democratic-republic-of-the-congo",
    "south korea": "south-korea",
    "north korea": "north-korea",
    "ivory coast": "cote-d-ivoire",
    "czech republic": "czechia",
    "burma": "myanmar",
    "vatican": "vatican-city",
  };
  if (aliases[trimmed]) return aliases[trimmed];
  return trimmed
    .replace(/[^a-z0-9\s-]/g, "") // strip punctuation
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Fetch the FCDO travel advisory for a country name. Returns `null` if
 * the country isn't tracked, the API errored, or the response was malformed
 * — never throws.
 *
 * Cache: per-process Map keyed by slug, 6h TTL. Cold serverless invocations
 * re-fetch; that's an acceptable ~10-100ms latency hit at most.
 */
export async function getFcdoAdvisory(
  country: string
): Promise<TravelAdvisory | null> {
  const slug = countryNameToFcdoSlug(country);
  if (!slug) return null;

  const cached = CACHE.get(slug);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.advisory;
  }

  const url = `https://www.gov.uk/api/content/foreign-travel-advice/${slug}`;
  let raw: FcdoApiResponse;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Tight timeout via AbortSignal — we render this on the trip page,
      // a slow upstream shouldn't block the route.
      signal: AbortSignal.timeout(4000),
      // Cache via Next.js data cache too — additional defense against
      // repeated cold-start re-fetches across the same deployment.
      next: { revalidate: 21600 },
    });
    if (!res.ok) {
      // 404 = unknown country slug, 5xx = upstream blip. Cache null
      // so we don't retry within the TTL window.
      CACHE.set(slug, { fetchedAt: Date.now(), advisory: null });
      return null;
    }
    raw = (await res.json()) as FcdoApiResponse;
  } catch (err) {
    // Timeout, network error, JSON parse failure — log + cache null.
    console.warn(
      "[advisories/fcdo] fetch failed",
      slug,
      err instanceof Error ? err.message : err
    );
    CACHE.set(slug, { fetchedAt: Date.now(), advisory: null });
    return null;
  }

  // `description` is the short headline ("FCDO travel advice for X.
  // Includes safety…"). It's not the prettiest copy but it's the
  // most consistent string the API exposes — `details.summary` is
  // null on every country we've inspected.
  const summary =
    raw.description?.trim() || "See full advisory for details.";
  // Title is "Afghanistan travel advice" → strip the suffix for cleaner
  // country names on the banner.
  const cleanedTitle = (raw.title || "")
    .replace(/\s*travel advice\s*$/i, "")
    .trim();
  const advisory: TravelAdvisory = {
    source: "fcdo",
    sourceCountry: "GB",
    countryName: cleanedTitle || country,
    level: deriveLevel(raw.details?.alert_status, summary),
    summary: summary.slice(0, 400),
    url: `https://www.gov.uk${raw.base_path ?? `/foreign-travel-advice/${slug}`}`,
    updatedAt:
      raw.public_updated_at ||
      raw.updated_at ||
      new Date().toISOString(),
  };

  CACHE.set(slug, { fetchedAt: Date.now(), advisory });
  return advisory;
}
