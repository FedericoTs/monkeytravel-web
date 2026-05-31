/**
 * Amazon Associates Affiliate Link Generator
 *
 * Day-6 P3 (monetization gap): wire Amazon affiliate links into the
 * packing-list tool so that each purchasable item has a "Buy on Amazon"
 * search-link beside it.
 *
 * The Amazon Associates program pays a per-item commission (1-10%
 * depending on category) on any qualifying purchase made within 24
 * hours of the click — even if the user ends up buying something
 * different from what they searched for. Search URLs (vs ASIN deep
 * links) are intentional: we don't want to recommend a specific
 * product the user might find low-quality, but the {tag} query
 * parameter still attributes any subsequent purchase to us.
 *
 * IMPORTANT: NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG is not yet provisioned
 * — onboarding to the Associates program requires an active site
 * with policy disclosures + a $0.01 first commission within 180
 * days of approval. Until the tag is live, the link still works
 * (Amazon search URL is publicly searchable), it just doesn't
 * attribute. The "TAG_TBD" fallback is deliberately recognisable
 * so a missing env var shows up in PostHog event captures and we
 * can audit click-through volume before we commit to onboarding.
 */

const AMAZON_TAG =
  process.env.NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG || "TAG_TBD";

/** Amazon US storefront — single locale for now. */
const AMAZON_BASE = "https://www.amazon.com/s";

/**
 * Categories from the AI-generated packing list that map to
 * Amazon-purchasable goods. The "documents" and "activity_gear"
 * categories are excluded by default:
 *  - documents: passports, visas, plane tickets — not Amazon-purchasable
 *  - activity_gear: too broad — surfaces "scuba tank" etc. that are
 *    rarely shipped by Amazon; revisit per-item when we have an
 *    item-level taxonomy.
 *
 * health and misc are included because items like band-aids, sleep
 * masks, ear plugs, and packing cubes all convert well.
 */
export const AMAZON_ALLOWLIST_CATEGORIES = new Set<string>([
  "clothing",
  "toiletries",
  "electronics",
  "health",
  "misc",
]);

/**
 * Item-name patterns that should NEVER get an Amazon link even when
 * their category is allowlisted. Catches edge cases like "passport
 * copies" landing in "documents" but also "boarding pass holder" in
 * misc — we exclude government-issued and travel-issued documents at
 * the name level for safety.
 *
 * Matching is substring + case-insensitive on the canonical English
 * item name. Localised lists will still pass through because Gemini
 * is prompted to emit English item names regardless of locale.
 */
const ITEM_NAME_DENYLIST = [
  "passport",
  "visa",
  "boarding pass",
  "plane ticket",
  "flight ticket",
  "id card",
  "driver's license",
  "drivers license",
  "insurance card",
  "vaccination card",
  "vaccine card",
];

/**
 * Decide whether an item should render a "Buy on Amazon" link.
 *
 * @param categoryId — the PackingCategory.id from the API response
 * @param itemName   — the raw item name as Gemini returned it
 */
export function shouldShowAmazonLink(
  categoryId: string,
  itemName: string
): boolean {
  if (!AMAZON_ALLOWLIST_CATEGORIES.has(categoryId)) return false;
  const lower = itemName.toLowerCase();
  for (const banned of ITEM_NAME_DENYLIST) {
    if (lower.includes(banned)) return false;
  }
  return true;
}

/**
 * Build the Amazon search URL for a packing-list item.
 *
 * Uses Amazon's `/s?k=<query>&tag=<associate-tag>` endpoint — the
 * same URL the user would land on if they typed the query into the
 * Amazon search bar, just with our attribution tag appended.
 */
export function buildAmazonSearchUrl(itemName: string): string {
  const q = encodeURIComponent(itemName.trim());
  return `${AMAZON_BASE}?k=${q}&tag=${AMAZON_TAG}`;
}

/** Exported for tests + analytics — never trust import-time eval. */
export function getAmazonTag(): string {
  return AMAZON_TAG;
}
