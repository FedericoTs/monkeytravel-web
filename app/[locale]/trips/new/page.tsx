import { getDestinationBySlug } from "@/lib/destinations/data";
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
type SearchParams = { destination?: string | string[] };

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

  return <NewTripWizard prefilledDestination={prefilledDestination} />;
}
