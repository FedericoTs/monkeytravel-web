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
 * Cached with Next's built-in fetch cache for 1 day per country.
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

/**
 * Fetch the FCDO advisory summary for a destination. Returns null when
 * the page doesn't exist (country slug mismatch) or the request fails
 * — the caller should fall back to rendering nothing rather than
 * blocking the result page on a free, supplementary API.
 *
 * Uses Next's revalidate caching at 24h so we don't hammer GOV.UK.
 */
export async function fetchGovukAdvisory(
  destinationIso2: string
): Promise<AdvisorySummary | null> {
  const slug = toGovukSlug(destinationIso2);
  if (!slug) return null;

  const url = `${CONTENT_API_BASE}/${slug}`;
  const humanUrl = `https://www.gov.uk/foreign-travel-advice/${slug}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // 24h cache — GOV.UK updates these pages a few times a week,
      // not by the minute. Matches our other free-data endpoints.
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return null;
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
    if (!summary) return null;

    // Cap the summary at ~280 chars so it fits the card without
    // overwhelming the visa result.
    if (summary.length > 280) {
      summary = summary.slice(0, 277).trimEnd() + "…";
    }

    return {
      summary,
      updatedAt: data.public_updated_at || data.updated_at,
      url: humanUrl,
    };
  } catch {
    return null;
  }
}
