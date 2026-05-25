/**
 * Visa requirement types — schema mirrors the imorte/passport-index-data
 * shape so we can drop in nightly refreshes without lossy mapping.
 */

/**
 * Visa status categories. Pulled verbatim from the imorte dataset's
 * documented vocabulary.
 *
 * - `visa free` — covers tourist registration (Seychelles), e-tickets
 *   (Dominican Republic), arrival cards (Singapore, Malaysia)
 * - `visa on arrival` — issued at port of entry, effectively visa-free
 * - `eta` — Electronic Travel Authorisation (ESTA US, eTA Canada,
 *   eVisitor Australia, eTourist Suriname)
 * - `e-visa` — Electronic visa, applied online before travel
 * - `visa required` — Standard pre-trip visa (also Cuba tourist cards,
 *   China Exit-Entry permits)
 * - `no admission` — Entry not permitted (sanctions, conflict, ban)
 * - `same country` — Internal lookup (when passport === destination,
 *   the raw data uses `-1`; we surface this synthetic status to the UI)
 */
export type VisaStatus =
  | "visa free"
  | "visa on arrival"
  | "eta"
  | "e-visa"
  | "visa required"
  | "no admission"
  | "same country";

/**
 * Raw cell as it appears in the JSON.
 */
export interface RawVisaCell {
  status: string; // exact string from dataset; not narrowed
  days?: number;
}

/**
 * Normalized result returned by `lookupVisaRequirement`.
 */
export interface VisaLookupResult {
  passport: string; // ISO-2 upper
  destination: string; // ISO-2 upper
  status: VisaStatus;
  /** Max stay in days for visa-free / VoA / eTA / e-visa cells. */
  days?: number;
}
