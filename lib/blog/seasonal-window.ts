/**
 * Derive a plausible FUTURE stay window from a seasonal post's own month.
 *
 * WHY THIS IS NEEDED
 * Hostelworld's search requires check-in and check-out dates
 * (see getHostelworldSearchUrl in lib/affiliates/hostelworld.ts). A blog
 * reader has given us neither — they are reading "Where to Go in December",
 * not planning dates. Rather than invent an arbitrary window or send a
 * date-less URL that lands on an empty search, we use the one date signal the
 * page genuinely carries: the month the article is about.
 *
 * The reader can change the dates on arrival; the point is to land them on a
 * populated results page for the right season instead of an empty one.
 *
 * THE ROLLOVER RULE
 * The window must never be in the past. Reading "Where to Go in October" in
 * December has to point at NEXT October, not the one that just ended — an
 * expired date range is the difference between a results page and an error.
 * A post whose month is still ahead this year uses this year.
 *
 * Mid-month (10th → 14th) is deliberate: it dodges month-boundary rollover
 * and the New Year / month-end price spikes that make a results page look
 * absurd.
 */

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

export interface StayWindow {
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Returns a 4-night mid-month window for the month named in the slug, or null
 * when the post is not month-specific (e.g. the monsoon guide spans a season,
 * not a month — there is no honest single window, so it gets no stay CTA).
 */
export function seasonalStayWindow(postSlug: string, now: Date = new Date()): StayWindow | null {
  // Match "where-to-go-in-<month>" and any future "<month>-..." seasonal slug,
  // but only as a whole hyphen-delimited segment: "-may-" must not match
  // inside a word, and "maybe" is not May.
  const segment = postSlug.split("-").find((s) => s in MONTHS);
  if (!segment) return null;

  const month = MONTHS[segment];
  const thisYear = now.getFullYear();

  // Compare against the END of the window, not the start: mid-October is still
  // "this October" on the 12th. Using the start would roll a reader sitting
  // inside the month forward a full year.
  const endThisYear = new Date(Date.UTC(thisYear, month, 14));
  const year = endThisYear.getTime() >= Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate(),
  ) ? thisYear : thisYear + 1;

  return {
    start: `${year}-${pad(month + 1)}-10`,
    end: `${year}-${pad(month + 1)}-14`,
  };
}
