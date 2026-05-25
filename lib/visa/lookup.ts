/**
 * Visa-requirement lookup.
 *
 * Data source: imorte/passport-index-data (MIT licensed, scraped from
 * passportindex.org, refreshed monthly upstream; we snapshot into
 * `matrix.json`). 199 passports × 199 destinations.
 *
 * IMPORTANT — what this is NOT: this is a planning aid, not legal
 * advice. Visa rules change without notice. Every result page MUST link
 * to the official source and tell users to verify before booking.
 */

import matrixData from "./matrix.json";
import type {
  RawVisaCell,
  VisaLookupResult,
  VisaStatus,
} from "./types";

// The JSON ships with ISO-2 codes in lowercase keys (e.g. "us", "gb").
// We normalize inputs to lowercase before lookup and uppercase outputs
// for display.
const matrix = matrixData as Record<string, Record<string, RawVisaCell | number>>;

/**
 * Cast the dataset's free-form `status` string to our typed union.
 * Unknown values default to "visa required" — fail safe, never under-state.
 */
function coerceStatus(raw: string): VisaStatus {
  switch (raw) {
    case "visa free":
    case "visa on arrival":
    case "eta":
    case "e-visa":
    case "visa required":
    case "no admission":
      return raw as VisaStatus;
    default:
      return "visa required";
  }
}

/**
 * Look up the visa requirement for a passport → destination pair.
 *
 * Inputs are ISO-2 codes (case-insensitive). Returns `null` for
 * unknown pairs (data gap), or a typed result for a hit.
 *
 * `same country` is surfaced as a synthetic status when passport
 * equals destination (the raw data stores `-1` for those cells).
 */
export function lookupVisaRequirement(
  passportIso2: string,
  destinationIso2: string
): VisaLookupResult | null {
  const from = passportIso2?.toLowerCase();
  const to = destinationIso2?.toLowerCase();
  if (!from || !to) return null;

  if (from === to) {
    return {
      passport: from.toUpperCase(),
      destination: to.toUpperCase(),
      status: "same country",
    };
  }

  const row = matrix[from];
  if (!row) return null;
  const cell = row[to];
  if (cell === undefined || cell === null) return null;

  // The dataset uses `-1` for same-country cells in alternative formats,
  // and the JSON uses object cells with `status` for everything else.
  if (typeof cell === "number") {
    if (cell === -1) {
      return {
        passport: from.toUpperCase(),
        destination: to.toUpperCase(),
        status: "same country",
      };
    }
    // Some forks use raw number cells for visa-free days. Map them
    // forward so we stay forward-compatible.
    return {
      passport: from.toUpperCase(),
      destination: to.toUpperCase(),
      status: "visa free",
      days: cell,
    };
  }

  return {
    passport: from.toUpperCase(),
    destination: to.toUpperCase(),
    status: coerceStatus(cell.status),
    days: typeof cell.days === "number" ? cell.days : undefined,
  };
}

/**
 * All ISO-2 codes known to the dataset. Used to build the dropdown
 * select options for both passport and destination inputs.
 */
export function getKnownIso2Codes(): string[] {
  return Object.keys(matrix).map((c) => c.toUpperCase()).sort();
}

/**
 * Total number of passport × destination pairs we have data for.
 * Used in the page footer for credibility ("199 × 199 = 39,601 pairs").
 */
export function getDatasetSize(): { passports: number; destinations: number; pairs: number } {
  const passports = Object.keys(matrix).length;
  const firstRow = Object.values(matrix)[0];
  const destinations = firstRow ? Object.keys(firstRow).length : 0;
  return {
    passports,
    destinations,
    pairs: passports * destinations,
  };
}
