/**
 * UK FCDO (Foreign, Commonwealth & Development Office) travel-advice client.
 *
 * The FCDO publishes country-specific travel advice as JSON at
 * https://www.gov.uk/api/world/{country-slug}/travel-advice. It's free,
 * unauthenticated, updated daily, and covers ~230 countries. We pull
 * the summary + alert level and surface it on the trip page so the user
 * sees the official UK position on travel safety alongside the AI's
 * itinerary.
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
  title?: string;
  base_path?: string;
  description?: string;
  updated_at?: string;
  public_updated_at?: string;
  details?: {
    summary?: string;
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
 * Map FCDO `alert_status` flags + summary heuristics → our level.
 *
 * FCDO uses strings like "avoid_all_travel", "avoid_all_but_essential_travel",
 * and "country_alert" in the alert_status array. We promote the most severe
 * to our 4-level scale:
 *   extreme  — "avoid all travel" anywhere
 *   high     — "avoid all but essential travel" anywhere
 *   advisory — country-wide alert or regional warnings
 *   low      — no alert present
 */
function deriveLevel(
  alertStatus: string[] | undefined,
  summary: string
): TravelAdvisory["level"] {
  const tags = (alertStatus ?? []).map((s) => s.toLowerCase());
  if (tags.some((t) => t.includes("avoid_all_travel"))) return "extreme";
  if (tags.some((t) => t.includes("avoid_all_but_essential_travel"))) {
    return "high";
  }
  if (tags.length > 0) return "advisory";

  // Heuristic fallback — when alert_status is absent the API sometimes
  // surfaces the severity in the summary text.
  const lower = summary.toLowerCase();
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

  const url = `https://www.gov.uk/api/world/${slug}/travel-advice`;
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

  const summary =
    raw.details?.summary?.trim() ||
    raw.description?.trim() ||
    "See full advisory for details.";
  const advisory: TravelAdvisory = {
    source: "fcdo",
    sourceCountry: "GB",
    countryName: raw.title?.replace(/^Travel advice for /i, "").trim() || country,
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
