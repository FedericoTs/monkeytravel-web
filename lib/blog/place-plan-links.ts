import { DESTINATION_ALLOWLIST } from "@/lib/trips/request-limits";
import { looksLikeRequest } from "@/lib/wizard/trip-sentence";
import { headingText } from "./api";

/**
 * "Plan this trip for March" under each place in a month's guide, and "Plan this trip" under each place of the other
 * lists of where to go (Christmas, New Year's Eve, the year's best places).
 *
 * Such a list ranks its places as "N. Place — why", one section each, and most
 * readers never reach the planner boxes around them. Each place heading gets a
 * link that opens the planner on that place, with dates pencilled in the guide's
 * month when it has one (`?month=`, read by the planner page). The place goes as
 * the reader saw it, in the page's language: the planner takes it as typed.
 */

/** "1. Japan — Cherry Blossom" is about Japan. An en dash counts, a hyphen doesn't. */
const RANKED_PLACE = /^\d{1,2}\.\s+(.+?)\s+[—–]\s/;

/** An article opening a place's name: "La costa sur de Sri Lanka", "L'Isola del Sud". */
const LEADING_ARTICLE = /^(?:(?:the|el|la|los|las|il|lo|i|gli|le|o|a|os|as)\s+|l')/i;

/**
 * The place a ranked section is about, or null when the heading isn't one or
 * the planner couldn't take the place as typed: characters a destination may
 * not hold, or more words than a place's name, which it reads as a request.
 * A long name may lose its article to fit ("El Pacífico de Costa Rica"); a
 * short one keeps it, so Las Vegas stays Las Vegas.
 */
export function placeOf(heading: string): string | null {
  const match = RANKED_PLACE.exec(heading.trim().replace(/[‘’]/g, "'"));
  if (!match) return null;
  const place = match[1].trim();
  const bare = place.replace(LEADING_ARTICLE, "");
  for (const candidate of [place, bare.charAt(0).toUpperCase() + bare.slice(1)]) {
    if (DESTINATION_ALLOWLIST.test(candidate) && !looksLikeRequest(candidate)) return candidate;
  }
  return null;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The article's HTML with the link after each ranked place's <h2>. `localePrefix`
 * is "" for English and "/es" etc. otherwise, as on the page. `nofollow`: the
 * planner is not indexed, and a dozen addresses per article only spend crawls.
 */
export function withPlacePlanLinks(
  html: string,
  { month, localePrefix, label }: { month: number | null; localePrefix: string; label: string },
): string {
  return html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (heading, _attrs: string | undefined, inner: string) => {
    const place = placeOf(headingText(inner));
    if (!place) return heading;
    const query = new URLSearchParams(
      month === null ? { destination: place, from: "place" } : { destination: place, month: String(month), from: "place" },
    );
    const href = `${localePrefix}/trips/new?${query.toString()}`;
    return `${heading}\n<p class="plan-place"><a href="${escapeHtml(href)}" rel="nofollow" data-plan-place="${escapeHtml(place)}">${escapeHtml(label)}</a></p>`;
  });
}
