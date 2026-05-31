/**
 * GOV.UK Foreign Travel Advice fetcher.
 *
 * The UK government publishes structured travel-advisory prose for
 * every country at https://www.gov.uk/foreign-travel-advice/{country}.
 * The Content API at content-api.publishing.service.gov.uk serves
 * the same data as JSON with no auth + no rate-limit headers
 * (it's Open Government Licence).
 *
 * We surface a single "summary" line + a link to the full page. The
 * UK uses Country names not ISO-2 codes — we map via Intl.DisplayNames.
 *
 * Caching strategy (TTL = 24h, keyed by lowercased ISO-2 destination):
 *   1. Per-Vercel-instance in-memory cache — short-circuits before any
 *      network or fetch-layer work on a warm Lambda.
 *   2. Next's built-in fetch cache via { next: { revalidate: 86_400 } }
 *      as a second line of defence when the in-memory cache is cold
 *      (cold start, new instance, after eviction).
 *
 * The 24h TTL is appropriate for our use case: this is a travel-planning
 * app, not a safety-critical one. Advisory text CAN change inside 24h in
 * a real emergency (earthquake, coup, terror attack) — accepting that
 * delay is a deliberate trade-off for cost and FCDO politeness. If the
 * product ever takes on a safety-critical role, drop the TTL to ~1h and
 * add an admin "purge advisory cache" hook.
 */

interface ContentApiResponse {
  title?: string;
  description?: string;
  details?: {
    summary?: string;
    parts?: Array<{
      slug?: string;
      title?: string;
      body?: string;
      updated_at?: string;
    }>;
  };
  updated_at?: string;
  public_updated_at?: string;
}

export interface AdvisorySummary {
  /** Short prose summary suitable for a card. */
  summary: string;
  /** Last updated by FCDO (ISO date). */
  updatedAt?: string;
  /** Link to the human-readable page (the URL is locale-agnostic). */
  url: string;
}

/**
 * GOV.UK uses url-friendly country slugs that don't always match
 * Intl.DisplayNames output (e.g. "Vatican City" → "the-holy-see").
 * Hand-curated overrides for the cases we know diverge.
 */
const GOVUK_SLUG_OVERRIDES: Record<string, string> = {
  US: "usa",
  GB: "", // GOV.UK doesn't advise UK citizens about UK
  KR: "south-korea",
  KP: "north-korea",
  RU: "russia",
  CD: "democratic-republic-of-the-congo",
  CG: "congo",
  CI: "ivory-coast",
  CZ: "czechia",
  DO: "dominican-republic",
  TL: "east-timor",
  MM: "myanmar-burma",
  PS: "the-occupied-palestinian-territories",
  CV: "cape-verde",
  VA: "the-holy-see",
  XK: "kosovo",
  SY: "syria",
  IR: "iran",
  AF: "afghanistan",
  TW: "taiwan",
  HK: "hong-kong",
  MO: "macao",
};

function toGovukSlug(destinationIso2: string): string | null {
  const code = destinationIso2.toUpperCase();
  if (code in GOVUK_SLUG_OVERRIDES) {
    const ov = GOVUK_SLUG_OVERRIDES[code];
    return ov || null;
  }
  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    const name = displayNames.of(code);
    if (!name) return null;
    return name
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  } catch {
    return null;
  }
}

const CONTENT_API_BASE =
  "https://www.gov.uk/api/content/foreign-travel-advice";

const ADVISORY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Per-instance in-memory cache for FCDO advisories.
 *
 * Keyed by lowercased ISO-2 country code. Survives across requests on
 * a warm Lambda. We also cache negative results (null) — countries that
 * GOV.UK doesn't cover (e.g. UK→UK), 404s, transient fetch errors — so
 * a single failure doesn't trigger a network call on every subsequent
 * render of the same destination for the next 24h.
 *
 * Memory footprint is bounded: ~250 ISO-2 codes × ~400 bytes per entry
 * worst-case ≈ 100 KB. No eviction needed.
 */
type AdvisoryCacheEntry = {
  value: AdvisorySummary | null;
  expiresAt: number;
};
const advisoryCache = new Map<string, AdvisoryCacheEntry>();

/**
 * Test/debug hook — clears the in-memory cache. Not exported to keep
 * the public surface minimal; tests can re-import the module if needed.
 */
function _clearAdvisoryCacheForTests(): void {
  advisoryCache.clear();
}
// Avoid TS "unused" complaints when the helper isn't referenced.
void _clearAdvisoryCacheForTests;

/**
 * Fetch the FCDO advisory summary for a destination. Returns null when
 * the page doesn't exist (country slug mismatch) or the request fails
 * — the caller should fall back to rendering nothing rather than
 * blocking the result page on a free, supplementary API.
 *
 * Caching: results (including nulls) are memoised per-instance for 24h,
 * keyed by lowercased ISO-2. A second 24h layer lives in Next's fetch
 * cache via `next.revalidate` for cold-start protection. See the
 * file-header comment for the rationale + safety trade-offs.
 */
export async function fetchGovukAdvisory(
  destinationIso2: string
): Promise<AdvisorySummary | null> {
  // Normalise the cache key so "us"/"US"/"Us" all hit the same entry.
  const cacheKey = destinationIso2.toLowerCase();

  const cached = advisoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const slug = toGovukSlug(destinationIso2);
  if (!slug) {
    advisoryCache.set(cacheKey, {
      value: null,
      expiresAt: Date.now() + ADVISORY_TTL_MS,
    });
    return null;
  }

  const url = `${CONTENT_API_BASE}/${slug}`;
  const humanUrl = `https://www.gov.uk/foreign-travel-advice/${slug}`;

  let value: AdvisorySummary | null = null;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Second cache layer — GOV.UK updates these pages a few times a
      // week, not by the minute. Matches our other free-data endpoints
      // and protects cold starts where the in-memory cache is empty.
      next: { revalidate: 86_400 },
    });
    if (!res.ok) {
      value = null;
    } else {
      const data = (await res.json()) as ContentApiResponse;

      // The "Summary" part is a short paragraph at the top of the page.
      // It's the most useful single line for a card. Fall back to the
      // top-level description if for some reason that part is missing.
      let summary =
        data.details?.parts?.find(
          (p) => p.slug === "summary" || /summary/i.test(p.title || "")
        )?.body || "";

      // Strip HTML — the body is HTML in the Content API.
      summary = summary
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!summary) {
        summary = (data.description || "").trim();
      }

      if (summary) {
        // Cap the summary at ~280 chars so it fits the card without
        // overwhelming the visa result.
        if (summary.length > 280) {
          summary = summary.slice(0, 277).trimEnd() + "…";
        }
        value = {
          summary,
          updatedAt: data.public_updated_at || data.updated_at,
          url: humanUrl,
        };
      }
    }
  } catch {
    value = null;
  }

  advisoryCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + ADVISORY_TTL_MS,
  });
  return value;
}
