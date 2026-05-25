/**
 * iVisa affiliate link builder.
 *
 * iVisa offers a 20% commission on every visa application, with a
 * 365-day cookie. Sign up at https://www.ivisa.com/affiliates and put
 * the affiliate ID in IVISA_AFFILIATE_ID.
 *
 * Until we have an approved ID, links go to the unbranded iVisa URL,
 * which still drives users to the right product but doesn't pay us.
 */

/**
 * Optional env var. When absent, links go to iVisa without our affiliate
 * tracking — better than a broken/empty link in production.
 */
const AFFILIATE_ID = process.env.NEXT_PUBLIC_IVISA_AFFILIATE_ID || "";

const COUNTRY_SLUG_OVERRIDES: Record<string, string> = {
  // iVisa uses friendly slugs for some destinations that don't match
  // a lower-cased country name 1:1. Add overrides as needed; the
  // default mapping covers most cases.
  US: "united-states",
  GB: "united-kingdom",
  AE: "united-arab-emirates",
  KR: "south-korea",
  KP: "north-korea",
  RU: "russia",
  CD: "democratic-republic-of-the-congo",
  CG: "republic-of-the-congo",
  CI: "ivory-coast",
  CZ: "czech-republic",
  DO: "dominican-republic",
  TL: "east-timor",
  MM: "myanmar",
  PS: "palestine",
  CV: "cape-verde",
  TW: "taiwan",
  HK: "hong-kong",
  MO: "macau",
  XK: "kosovo",
  VA: "vatican-city",
};

/**
 * Convert an ISO-2 destination code to the iVisa URL slug.
 * Fallback uses `Intl.DisplayNames` to derive the country name, then
 * kebab-cases it — works for almost all cases.
 */
function toIvisaSlug(iso2: string): string {
  const code = iso2.toUpperCase();
  if (COUNTRY_SLUG_OVERRIDES[code]) return COUNTRY_SLUG_OVERRIDES[code];
  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    const name = displayNames.of(code);
    if (!name) return code.toLowerCase();
    return name
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  } catch {
    return code.toLowerCase();
  }
}

/**
 * Build the iVisa affiliate URL for a given passport → destination pair.
 * Returns null when iVisa doesn't serve the destination (rare).
 */
export function buildIvisaAffiliateUrl(
  destinationIso2: string,
  passportIso2: string
): string {
  const dest = toIvisaSlug(destinationIso2);
  const passport = toIvisaSlug(passportIso2);
  // iVisa structure: /visa/{destination-slug}/{passport-slug}
  const base = `https://www.ivisa.com/visa/${dest}/${passport}`;
  if (!AFFILIATE_ID) return base;
  // iVisa uses utm_source=affiliate + utm_medium=monkeytravel + cid=<id>
  // per their affiliate dashboard convention.
  const url = new URL(base);
  url.searchParams.set("utm_source", "affiliate");
  url.searchParams.set("utm_medium", "monkeytravel");
  url.searchParams.set("utm_campaign", "visa_checker");
  url.searchParams.set("cid", AFFILIATE_ID);
  return url.toString();
}

/**
 * Should we surface the iVisa CTA for this visa status? Yes for
 * statuses where the user actually needs to take action.
 */
export function shouldShowIvisaCta(status: string): boolean {
  return ["visa required", "e-visa", "eta", "visa on arrival"].includes(
    status
  );
}
