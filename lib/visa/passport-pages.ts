import "server-only";

import matrixData from "./matrix.json";
import { iso2ToFlag, getCountryName } from "./countries";
import type { VisaStatus } from "./types";

/**
 * Per-passport "where can I actually go" pages.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE PASSPORT-INDEX POST
 * /blog/passport-power-index-2026 serves generic ranking queries —
 * "henley passport index 2026", "passport ranking 2026", "top 10 weakest
 * passport" — which Henley owns and which Google answers in the SERP. No
 * amount of on-page work converts those.
 *
 * The adjacent intent is different and unserved: "us passport visa-free
 * countries", "argentine passport visa free countries", "2026 henley passport
 * index japan ranking visa-free". Those are PER-PASSPORT, they currently land
 * on the generic ranking article, and a SERP snippet cannot answer them
 * because the answer is a ~199-row table specific to one passport.
 *
 * WHY A SHORTLIST AND NOT ALL 199
 * 199 passports x 4 locales is 796 pages of table data, which is precisely the
 * shape Google's scaled-content-abuse policy targets — and this site was
 * audited against the 2026 spam update. The shortlist below is drawn from
 * audience that Search Console already shows, so every page here has
 * demonstrated demand behind it.
 *
 * Add a passport when the data says people from there are finding us, not to
 * fill out the map.
 */

/**
 * Passports we build pages for, ordered by Search Console demand, highest
 * first. The list stops where the demand does.
 */
export const PASSPORT_PAGE_CODES = [
  "US",
  "IN",
  "NL",
  "IT",
  "GB",
  "ES",
  "DE",
  "CA",
  "BR",
  "AU",
  "MX",
  "JP",
  "SG",
  "KR",
  "PH",
  "FR",
  "MY",
  "AE",
  "ID",
  "PK",
] as const;

export type PassportCode = (typeof PASSPORT_PAGE_CODES)[number];

/**
 * URL slug per passport. Deliberately hand-written rather than derived from
 * the localized country name: the slug is part of the canonical URL and must
 * stay byte-stable across locales and across any future rename of a display
 * name. English, lowercase, hyphenated.
 */
const SLUGS: Record<PassportCode, string> = {
  US: "united-states",
  IN: "india",
  NL: "netherlands",
  IT: "italy",
  GB: "united-kingdom",
  ES: "spain",
  DE: "germany",
  CA: "canada",
  BR: "brazil",
  AU: "australia",
  MX: "mexico",
  JP: "japan",
  SG: "singapore",
  KR: "south-korea",
  PH: "philippines",
  FR: "france",
  MY: "malaysia",
  AE: "united-arab-emirates",
  ID: "indonesia",
  PK: "pakistan",
};

const BY_SLUG = new Map<string, PassportCode>(
  (Object.entries(SLUGS) as [PassportCode, string][]).map(([code, slug]) => [slug, code]),
);

export function passportSlug(code: PassportCode): string {
  return SLUGS[code];
}

export function passportCodeForSlug(slug: string): PassportCode | null {
  return BY_SLUG.get(slug.toLowerCase()) ?? null;
}

export function allPassportSlugs(): string[] {
  return PASSPORT_PAGE_CODES.map((c) => SLUGS[c]);
}

/**
 * The statuses we group by, in the order a traveller cares about: what can I
 * do with no paperwork, then what needs a little, then what needs a lot.
 *
 * `same country` is dropped rather than rendered — a passport's own country is
 * not a destination, and the raw dataset encodes it as -1.
 */
export const GROUP_ORDER: VisaStatus[] = [
  "visa free",
  "visa on arrival",
  "eta",
  "e-visa",
  "visa required",
  "no admission",
];

export interface PassportDestination {
  iso2: string;
  name: string;
  flag: string;
  days?: number;
}

export interface PassportSummary {
  code: PassportCode;
  slug: string;
  name: string;
  flag: string;
  /** Destinations excluding the passport's own country. */
  total: number;
  /** Count per status, keyed by the same strings as GROUP_ORDER. */
  counts: Record<string, number>;
  /**
   * The headline number: everywhere you can board a plane to without applying
   * for anything in advance. visa-free + visa-on-arrival, NOT eTA or e-visa,
   * because both of those require an application before you fly.
   */
  noAdvancePaperwork: number;
  groups: { status: VisaStatus; destinations: PassportDestination[] }[];
  /** iso2 -> status, for colouring the map. Small enough to send to the client. */
  statusByIso2: Record<string, VisaStatus>;
}

type RawCell = { status?: string; days?: number } | number;
const matrix = matrixData as Record<string, Record<string, RawCell>>;

/**
 * Normalize a raw cell's status. Mirrors lookup.ts's `coerceStatus`, which
 * defaults unknown values to "visa required" — fail safe, never under-state
 * what a traveller needs. Duplicated rather than imported because lookup.ts
 * does not export it, and under-stating here would be worse than a duplicate.
 */
function coerceStatus(raw: unknown): VisaStatus {
  if (typeof raw === "number") return "same country";
  const s = String(raw ?? "").toLowerCase().trim();
  switch (s) {
    case "visa free":
    case "visa on arrival":
    case "eta":
    case "e-visa":
    case "no admission":
      return s as VisaStatus;
    case "visa required":
      return "visa required";
    case "-1":
      return "same country";
    default:
      return "visa required";
  }
}

/**
 * Build everything a passport page renders, server-side.
 *
 * BUNDLE NOTE: matrix.json is 2.4MB and this module is `server-only` so it can
 * never be pulled into a client chunk. Callers must pass the RESULT down to
 * client components, never the module — the same discipline
 * app/[locale]/(app)/trips/new/page.tsx applies to the 477KB destinations dataset it
 * was previously dragging into the wizard bundle.
 */
export function getPassportSummary(
  code: PassportCode,
  locale: string,
): PassportSummary | null {
  const row = matrix[code];
  if (!row) return null;

  const counts: Record<string, number> = {};
  const buckets = new Map<VisaStatus, PassportDestination[]>();
  const statusByIso2: Record<string, VisaStatus> = {};
  let total = 0;

  for (const [dest, cell] of Object.entries(row)) {
    if (dest === code) continue; // a passport's own country is not a destination
    const status = coerceStatus(typeof cell === "object" ? cell?.status : cell);
    if (status === "same country") continue;

    total += 1;
    counts[status] = (counts[status] ?? 0) + 1;
    statusByIso2[dest] = status;

    const days = typeof cell === "object" ? cell?.days : undefined;
    const list = buckets.get(status) ?? [];
    list.push({
      iso2: dest,
      name: getCountryName(dest, locale),
      flag: iso2ToFlag(dest),
      ...(typeof days === "number" ? { days } : {}),
    });
    buckets.set(status, list);
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, locale));
  }

  return {
    code,
    slug: SLUGS[code],
    name: getCountryName(code, locale),
    flag: iso2ToFlag(code),
    total,
    counts,
    noAdvancePaperwork: (counts["visa free"] ?? 0) + (counts["visa on arrival"] ?? 0),
    groups: GROUP_ORDER.filter((s) => (buckets.get(s)?.length ?? 0) > 0).map((s) => ({
      status: s,
      destinations: buckets.get(s)!,
    })),
    statusByIso2,
  };
}
