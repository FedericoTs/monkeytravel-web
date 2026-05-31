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
 *      network or DB work on a warm Lambda.
 *   2. fcdo_advisory_cache table (Supabase) — shared across instances,
 *      survives cold starts. The earlier in-memory-only design made
 *      every new Lambda re-fetch every advisory the page touched; the
 *      DB tier eliminates that fan-out (~1 row read instead of an
 *      outbound GOV.UK request).
 *   3. Next's built-in fetch cache via { next: { revalidate: 86_400 } }
 *      as a third line of defence on cold starts where even the DB
 *      tier is cold (first request to a given country after expiry).
 *
 * Write-through: when we fetch upstream we populate BOTH the in-memory
 * Map and the DB row so the next caller on any instance hits the DB.
 *
 * The 24h TTL is appropriate for our use case: this is a travel-planning
 * app, not a safety-critical one. Advisory text CAN change inside 24h in
 * a real emergency (earthquake, coup, terror attack) — accepting that
 * delay is a deliberate trade-off for cost and FCDO politeness. If the
 * product ever takes on a safety-critical role, drop the TTL to ~1h and
 * add an admin "purge advisory cache" hook.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

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
 * Lazy service-role client for the DB cache tier. Service-role is
 * required for writes (RLS blocks INSERT/UPSERT for anon/authenticated);
 * reads would work via anon but using the same client avoids a second
 * pooled connection for no benefit. The cache table holds nothing
 * sensitive (a copy of a public GOV.UK page) so this is safe.
 *
 * Wrapped in a getter so the import doesn't crash in environments
 * without Supabase env vars set (tests, local dev without .env, the
 * `next build` static analysis pass). On any env miss we return null
 * and the caller skips the DB tier silently — degrading gracefully
 * back to in-memory + upstream fetch only.
 */
let _cachedServiceClient: SupabaseClient | null = null;
let _serviceClientChecked = false;
function getServiceClient(): SupabaseClient | null {
  if (_serviceClientChecked) return _cachedServiceClient;
  _serviceClientChecked = true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _cachedServiceClient = createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _cachedServiceClient;
}

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
 * Read a non-expired row from the DB tier. Returns:
 *   - { value: AdvisorySummary | null }  ← cache hit (incl. negative)
 *   - null                               ← miss / disabled / error
 *
 * Note the discriminator: we MUST distinguish "row exists with null
 * summary" (a cached negative — don't re-fetch upstream) from "no row
 * found / DB unreachable" (try upstream). The outer null means "no
 * cached answer of any kind"; the inner `.value: null` means "cached
 * negative".
 */
async function readDbCache(
  cacheKey: string
): Promise<{ value: AdvisorySummary | null } | null> {
  const supabase = getServiceClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("fcdo_advisory_cache")
      .select("summary, url, updated_at, expires_at")
      .eq("country_code", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;

    // Cached negative — row exists but no usable advisory.
    if (!data.summary || !data.url) {
      return { value: null };
    }

    return {
      value: {
        summary: data.summary,
        url: data.url,
        updatedAt: data.updated_at ?? undefined,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Write-through to the DB tier. Fire-and-forget — failures are logged
 * but never thrown. Callers should never have a render path blocked by
 * a cache write.
 */
async function writeDbCache(
  cacheKey: string,
  value: AdvisorySummary | null,
  expiresAtMs: number
): Promise<void> {
  const supabase = getServiceClient();
  if (!supabase) return;

  try {
    const { error } = await supabase.from("fcdo_advisory_cache").upsert(
      {
        country_code: cacheKey,
        summary: value?.summary ?? null,
        url: value?.url ?? null,
        updated_at: value?.updatedAt ?? null,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(expiresAtMs).toISOString(),
      },
      { onConflict: "country_code" }
    );
    if (error) {
      console.error(
        `[govuk-advisory] DB cache write error for ${cacheKey}:`,
        error.message
      );
    }
  } catch (err) {
    console.error("[govuk-advisory] DB cache write exception:", err);
  }
}

/**
 * Fetch the FCDO advisory summary for a destination. Returns null when
 * the page doesn't exist (country slug mismatch) or the request fails
 * — the caller should fall back to rendering nothing rather than
 * blocking the result page on a free, supplementary API.
 *
 * Caching: results (including nulls) are memoised for 24h, keyed by
 * lowercased ISO-2, across three tiers:
 *   1. Per-instance in-memory Map (fastest)
 *   2. fcdo_advisory_cache Supabase table (shared across instances)
 *   3. Next's fetch cache via `next.revalidate` (cold-start protection)
 *
 * On upstream fetch we write through to BOTH tier 1 and tier 2.
 */
export async function fetchGovukAdvisory(
  destinationIso2: string
): Promise<AdvisorySummary | null> {
  // Normalise the cache key so "us"/"US"/"Us" all hit the same entry.
  const cacheKey = destinationIso2.toLowerCase();

  // Tier 1: in-memory.
  const cached = advisoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Tier 2: DB. On hit, promote into tier 1 with the remaining TTL
  // capped at 24h from now (we don't know the DB row's original
  // fetched_at to the millisecond, and a fresh 24h on the in-memory
  // copy is fine — the DB will re-arbitrate when it expires).
  const dbHit = await readDbCache(cacheKey);
  if (dbHit) {
    advisoryCache.set(cacheKey, {
      value: dbHit.value,
      expiresAt: Date.now() + ADVISORY_TTL_MS,
    });
    return dbHit.value;
  }

  const slug = toGovukSlug(destinationIso2);
  if (!slug) {
    const expiresAt = Date.now() + ADVISORY_TTL_MS;
    advisoryCache.set(cacheKey, { value: null, expiresAt });
    void writeDbCache(cacheKey, null, expiresAt);
    return null;
  }

  const url = `${CONTENT_API_BASE}/${slug}`;
  const humanUrl = `https://www.gov.uk/foreign-travel-advice/${slug}`;

  let value: AdvisorySummary | null = null;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Third cache layer — GOV.UK updates these pages a few times a
      // week, not by the minute. Matches our other free-data endpoints
      // and protects cold starts where both in-memory and DB are empty.
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

  // Write-through to both tiers. DB write is fire-and-forget — a slow
  // DB shouldn't block the render that just paid the upstream cost.
  const expiresAt = Date.now() + ADVISORY_TTL_MS;
  advisoryCache.set(cacheKey, { value, expiresAt });
  void writeDbCache(cacheKey, value, expiresAt);
  return value;
}
