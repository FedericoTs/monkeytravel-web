import { getDestinationBySlug } from "@/lib/destinations/data";
import { isExploreUgcEnabled } from "@/lib/explore/flag";
import type { Locale } from "@/lib/destinations/types";
import NewTripWizard, { type PrefilledDestination } from "./NewTripWizard";

/**
 * Server-component shell for the /trips/new wizard.
 *
 * Why this exists (task #152 / #167):
 *   The wizard is a heavy `"use client"` interactive surface. Its only
 *   coupling to the curated destinations dataset (`lib/destinations/data.ts`,
 *   ~477 KB) was a one-line lookup in a mount effect to resolve the
 *   optional `?destination=<slug>` deeplink (e.g. coming from a
 *   /destinations/<slug> page or a blog CTA). Importing
 *   `getDestinationBySlug` from a client component dragged the entire
 *   destinations array into the /trips/new client chunk — ~150 KB gz on
 *   the highest-traffic conversion page.
 *
 * Fix:
 *   - This server component resolves the slug against the dataset
 *     server-side, then hands the client wizard a small JSON-serializable
 *     `prefilledDestination` payload (just name + coords).
 *   - The wizard itself no longer imports `lib/destinations/data`, so the
 *     dataset never reaches the browser.
 *   - `data.ts` is marked `import "server-only"` to keep that boundary
 *     enforced at build time.
 *
 * Metadata for this route still comes from the adjacent `layout.tsx`
 * (which is also server-rendered) — the wizard component can't export
 * `metadata` itself because it's a client component.
 */
type SearchParams = {
  destination?: string | string[];
  days?: string | string[];
  budget?: string | string[];
  vibes?: string | string[];
};

/** First value of a possibly-repeated query param. */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Trip shape carried in from a blog CTA (see lib/blog/trip-prefill.ts).
 *
 * Validated HERE rather than in the client wizard for the same reason the
 * destination slug is: a bad value should resolve to "no prefill", never to a
 * wizard holding a 400-day trip or a budget tier that isn't one of the three.
 * Anything unrecognized is dropped silently — the reader typed none of this,
 * so there is nothing to report to them.
 */
export interface PrefilledTripShape {
  days: number | null;
  budget: "budget" | "balanced" | "premium" | null;
  vibes: string[];
}

/** Mirrors MAX_TRIP_DAYS in NewTripWizard.tsx — the single-city generate cap. */
const MAX_PREFILL_DAYS = 14;

/** The 6 vibes step 2 actually renders. Legacy vibe values are not accepted. */
const PREFILLABLE_VIBES = new Set([
  "adventure",
  "cultural",
  "foodie",
  "romantic",
  "nature",
  "urban",
]);

function parseTripShape(sp: SearchParams): PrefilledTripShape {
  const rawDays = one(sp.days);
  const parsedDays = rawDays ? Number.parseInt(rawDays, 10) : Number.NaN;
  const days =
    Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= MAX_PREFILL_DAYS
      ? parsedDays
      : null;

  const rawBudget = one(sp.budget);
  const budget =
    rawBudget === "budget" || rawBudget === "balanced" || rawBudget === "premium"
      ? rawBudget
      : null;

  const vibes = (one(sp.vibes) ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => PREFILLABLE_VIBES.has(v))
    .slice(0, 3);

  return { days, budget, vibes };
}

export default async function NewTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);

  let prefilledDestination: PrefilledDestination | null = null;
  const rawSlug = Array.isArray(sp.destination) ? sp.destination[0] : sp.destination;
  if (rawSlug) {
    const known = getDestinationBySlug(rawSlug.toLowerCase());
    if (known) {
      // Locales other than the three our content is authored in (en/es/it)
      // can still hit this route via the middleware fallback; default to
      // the English name in that case rather than indexing with `undefined`.
      const safeLocale: Locale =
        locale === "es" || locale === "it" || locale === "en"
          ? (locale as Locale)
          : "en";
      prefilledDestination = {
        name: known.name[safeLocale],
        latitude: known.coordinates.lat,
        longitude: known.coordinates.lng,
      };
    }
  }

  // Resolved server-side and handed down, because the client can't read
  // EXPLORE_UGC_ENABLED. This is the SAME gate TripEngagementSection uses on
  // /trips/[id], so both publish surfaces now answer to one switch.
  return (
    <NewTripWizard
      prefilledDestination={prefilledDestination}
      prefilledTripShape={parseTripShape(sp)}
      exploreUgcEnabled={isExploreUgcEnabled()}
    />
  );
}
