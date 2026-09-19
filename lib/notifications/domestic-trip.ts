/**
 * Is this trip inside the traveller's own country? — the visa-check reminder
 * must not fire for it.
 *
 * Why (2026-09-19): a recipient replied to "One week out — visa check —
 * Stillwater" that he was travelling inside Minnesota. The slot was timed on
 * days-to-departure only; nothing compared where the person is with where
 * they are going. Across the 60 days before the fix, 41 of 167 visa reminders
 * pending or sent were domestic (Sedona for a US viewer, Baguio for a
 * Philippine one, Valencia for a Spanish one).
 *
 * What we can compare. The trip's destination string names a country on
 * about half the trips and the profile home-country field is empty for 593
 * of 601 users, so neither is the source. Every trip's itinerary carries
 * activity addresses written by Google Places ("... Kyoto, 605-0071, Japan",
 * "... Stillwater, MN 55082, USA"), and every user with a pending reminder
 * has a country on their last page view. Those two are what this compares.
 *
 * FAIL OPEN. A reminder that might matter is worth more than a redundant
 * one, so the trip counts as domestic only when EVERY address that resolves
 * to a country resolves to the viewer's country, at least one does, and no
 * address resolved to somewhere else. Any address we cannot read is ignored;
 * an itinerary where none can be read, or an unknown viewer country, sends
 * the reminder exactly as before.
 *
 * Known limit, accepted: someone abroad when they plan a trip home is
 * "domestic" by their last page view (1 of 167 users in the sample). The
 * profile field could correct it once people fill it in.
 */

export interface DomesticVerdict {
  /** true only when the trip is inside the viewer's country by the rule above. */
  domestic: boolean;
  /** The viewer's country, ISO 3166-1 alpha-2, or null when unknown. */
  viewerCountry: string | null;
  /** Distinct destination countries that resolved, alpha-2. */
  destinationCountries: string[];
  /** How many addresses were read and how many resolved. */
  addresses: number;
  resolved: number;
}

// Country names as Google Places writes them at the end of a formatted
// address, plus the Italian, Spanish and Portuguese spellings the model
// sometimes writes when the wizard ran in those locales. Lower-case,
// diacritics kept (the input is normalised the same way).
const COUNTRY_BY_NAME: Record<string, string> = {
  // North America
  "usa": "US", "united states": "US", "united states of america": "US", "estados unidos": "US", "stati uniti": "US",
  "canada": "CA", "canadá": "CA", "mexico": "MX", "méxico": "MX", "messico": "MX",
  "puerto rico": "US", "guam": "US", "us virgin islands": "US",
  // Central America & Caribbean
  "costa rica": "CR", "panama": "PA", "panamá": "PA", "belize": "BZ", "guatemala": "GT", "honduras": "HN", "nicaragua": "NI", "el salvador": "SV",
  "cuba": "CU", "jamaica": "JM", "dominican republic": "DO", "república dominicana": "DO", "bahamas": "BS", "the bahamas": "BS", "barbados": "BB",
  "aruba": "AW", "curaçao": "CW", "curacao": "CW", "sint maarten": "SX", "saint barthélemy": "BL", "st. barthélemy": "BL", "saint lucia": "LC", "st. lucia": "LC",
  "grenada": "GD", "antigua and barbuda": "AG", "trinidad and tobago": "TT", "cayman islands": "KY", "turks and caicos islands": "TC", "bermuda": "BM",
  // South America
  "brazil": "BR", "brasil": "BR", "argentina": "AR", "chile": "CL", "colombia": "CO", "peru": "PE", "perú": "PE", "ecuador": "EC", "bolivia": "BO",
  "uruguay": "UY", "paraguay": "PY", "venezuela": "VE", "guyana": "GY", "suriname": "SR",
  // Western Europe
  "united kingdom": "GB", "uk": "GB", "regno unito": "GB", "reino unido": "GB", "england": "GB", "scotland": "GB", "wales": "GB", "northern ireland": "GB",
  "ireland": "IE", "irlanda": "IE", "france": "FR", "francia": "FR", "frança": "FR", "monaco": "MC", "spain": "ES", "españa": "ES", "spagna": "ES", "espanha": "ES",
  "portugal": "PT", "portogallo": "PT", "italy": "IT", "italia": "IT", "itália": "IT", "vatican city": "VA", "città del vaticano": "VA", "san marino": "SM",
  "germany": "DE", "deutschland": "DE", "germania": "DE", "alemania": "DE", "alemanha": "DE", "austria": "AT", "österreich": "AT", "áustria": "AT",
  "switzerland": "CH", "schweiz": "CH", "suisse": "CH", "svizzera": "CH", "suiza": "CH", "suíça": "CH", "liechtenstein": "LI",
  "netherlands": "NL", "the netherlands": "NL", "nederland": "NL", "paesi bassi": "NL", "países bajos": "NL", "países baixos": "NL",
  "belgium": "BE", "belgique": "BE", "belgië": "BE", "belgio": "BE", "bélgica": "BE", "luxembourg": "LU", "lussemburgo": "LU", "luxemburgo": "LU",
  "denmark": "DK", "danmark": "DK", "danimarca": "DK", "dinamarca": "DK", "sweden": "SE", "sverige": "SE", "svezia": "SE", "suecia": "SE", "suécia": "SE",
  "norway": "NO", "norge": "NO", "norvegia": "NO", "noruega": "NO", "finland": "FI", "suomi": "FI", "finlandia": "FI", "finlândia": "FI", "iceland": "IS", "ísland": "IS", "islanda": "IS", "islandia": "IS", "islândia": "IS",
  // Central & Eastern Europe
  "poland": "PL", "polska": "PL", "polonia": "PL", "polónia": "PL", "czechia": "CZ", "czech republic": "CZ", "česko": "CZ", "repubblica ceca": "CZ", "república checa": "CZ", "chéquia": "CZ",
  "slovakia": "SK", "slovacchia": "SK", "eslovaquia": "SK", "eslováquia": "SK", "hungary": "HU", "magyarország": "HU", "ungheria": "HU", "hungría": "HU", "hungria": "HU",
  "romania": "RO", "românia": "RO", "rumania": "RO", "rumanía": "RO", "roménia": "RO", "bulgaria": "BG", "bulgária": "BG", "greece": "GR", "grecia": "GR", "grécia": "GR",
  "croatia": "HR", "hrvatska": "HR", "croazia": "HR", "croacia": "HR", "croácia": "HR", "slovenia": "SI", "slovenija": "SI", "eslovenia": "SI", "eslovénia": "SI",
  "serbia": "RS", "srbija": "RS", "sérvia": "RS", "bosnia and herzegovina": "BA", "montenegro": "ME", "north macedonia": "MK", "albania": "AL", "albânia": "AL", "kosovo": "XK",
  "estonia": "EE", "latvia": "LV", "lithuania": "LT", "lituania": "LT", "lituânia": "LT", "belarus": "BY", "ukraine": "UA", "ucraina": "UA", "ucrania": "UA", "ucrânia": "UA",
  "russia": "RU", "россия": "RU", "moldova": "MD", "malta": "MT", "cyprus": "CY", "cipro": "CY", "chipre": "CY", "türkiye": "TR", "turkey": "TR", "turchia": "TR", "turquía": "TR", "turquia": "TR",
  "georgia": "GE", "armenia": "AM", "azerbaijan": "AZ",
  // Middle East & North Africa
  "israel": "IL", "jordan": "JO", "lebanon": "LB", "united arab emirates": "AE", "uae": "AE", "emirati arabi uniti": "AE", "emiratos árabes unidos": "AE", "qatar": "QA", "oman": "OM", "saudi arabia": "SA", "bahrain": "BH", "kuwait": "KW",
  "egypt": "EG", "egitto": "EG", "egipto": "EG", "morocco": "MA", "marocco": "MA", "marruecos": "MA", "marrocos": "MA", "tunisia": "TN", "túnez": "TN", "tunísia": "TN", "algeria": "DZ",
  // Sub-Saharan Africa
  "kenya": "KE", "tanzania": "TZ", "uganda": "UG", "rwanda": "RW", "ethiopia": "ET", "south africa": "ZA", "sudafrica": "ZA", "sudáfrica": "ZA", "áfrica do sul": "ZA",
  "namibia": "NA", "botswana": "BW", "zimbabwe": "ZW", "zambia": "ZM", "mozambique": "MZ", "madagascar": "MG", "mauritius": "MU", "seychelles": "SC", "réunion": "RE", "reunion": "RE",
  "ghana": "GH", "nigeria": "NG", "senegal": "SN", "cape verde": "CV", "cabo verde": "CV",
  // South & Central Asia
  "india": "IN", "sri lanka": "LK", "nepal": "NP", "bhutan": "BT", "maldives": "MV", "pakistan": "PK", "bangladesh": "BD",
  "kazakhstan": "KZ", "uzbekistan": "UZ", "kyrgyzstan": "KG", "tajikistan": "TJ", "mongolia": "MN",
  // East & Southeast Asia
  "japan": "JP", "giappone": "JP", "japón": "JP", "japão": "JP", "south korea": "KR", "korea": "KR", "corea del sud": "KR", "corea del sur": "KR", "coreia do sul": "KR",
  "china": "CN", "cina": "CN", "hong kong": "HK", "macau": "MO", "macao": "MO", "taiwan": "TW",
  "thailand": "TH", "thailandia": "TH", "tailandia": "TH", "tailândia": "TH", "vietnam": "VN", "cambodia": "KH", "cambogia": "KH", "camboya": "KH", "camboja": "KH", "laos": "LA", "myanmar": "MM",
  "malaysia": "MY", "malesia": "MY", "malasia": "MY", "malásia": "MY", "singapore": "SG", "singapur": "SG", "singapura": "SG", "indonesia": "ID", "indonésia": "ID", "philippines": "PH", "filippine": "PH", "filipinas": "PH", "brunei": "BN",
  // Oceania
  "australia": "AU", "austrália": "AU", "new zealand": "NZ", "nuova zelanda": "NZ", "nueva zelanda": "NZ", "nova zelândia": "NZ", "fiji": "FJ", "french polynesia": "PF", "polinesia francese": "PF", "polinesia francesa": "PF",
};

// A trailing "STATE ZIP" the way Google writes US addresses ("MN 55082")
// and Canadian ones ("ON M5J 2W2"): the country is implied, not written.
const US_STATES = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc",
]);
const CA_PROVINCES = new Set(["ab","bc","mb","nb","nl","ns","nt","nu","on","pe","qc","sk","yt"]);

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The country an activity address points at, alpha-2, or null when the
 * address does not say (a bare postcode, "various locations", a note the
 * model wrote instead of an address).
 */
export function countryFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  // The model sometimes appends a note: "…, Japan (near the station)". Drop
  // it, and a stray closing bracket left behind by a truncated one.
  const cleaned = address.replace(/\([^)]*\)?/g, " ").replace(/\)/g, " ");
  const parts = cleaned.split(",").map(normalise).filter(Boolean);
  if (parts.length === 0) return null;

  // Read the last three tokens, last first: "98000 monaco" and "taiwan 108"
  // both carry the country next to a postcode; "Hood River, OR 97031" carries
  // a US state instead of a country.
  for (const token of parts.slice(-3).reverse()) {
    const direct = COUNTRY_BY_NAME[token];
    if (direct) return direct;
    const words = token.split(" ");
    // Country with a postcode on either side.
    const withoutDigits = words.filter((w) => !/^\d[\d-]*$/.test(w)).join(" ");
    if (withoutDigits && withoutDigits !== token && COUNTRY_BY_NAME[withoutDigits]) return COUNTRY_BY_NAME[withoutDigits];
    // "MN 55082" / "ON M5J 2W2" / "OR 97031": state or province, then a code.
    if (words.length >= 2 && /^[a-z]{2}$/.test(words[0]) && /\d/.test(words.slice(1).join(""))) {
      if (US_STATES.has(words[0])) return "US";
      if (CA_PROVINCES.has(words[0])) return "CA";
    }
  }
  return null;
}

/**
 * Every activity address in an itinerary, in day order. Tolerates any
 * shape: the itinerary column is JSON the model wrote.
 */
export function itineraryAddresses(itinerary: unknown): string[] {
  if (!Array.isArray(itinerary)) return [];
  const out: string[] = [];
  for (const day of itinerary) {
    const acts = (day as { activities?: unknown } | null)?.activities;
    if (!Array.isArray(acts)) continue;
    for (const a of acts) {
      const addr = (a as { address?: unknown } | null)?.address;
      if (typeof addr === "string" && addr.trim()) out.push(addr);
    }
  }
  return out;
}

export function domesticTripVerdict(viewerCountry: string | null | undefined, itinerary: unknown): DomesticVerdict {
  const viewer = viewerCountry ? viewerCountry.toUpperCase() : null;
  const addresses = itineraryAddresses(itinerary);
  const countries = new Set<string>();
  let resolved = 0;
  for (const addr of addresses) {
    const cc = countryFromAddress(addr);
    if (cc) {
      countries.add(cc);
      resolved += 1;
    }
  }
  const destinationCountries = [...countries].sort();
  const domestic = viewer !== null && resolved > 0 && destinationCountries.length === 1 && destinationCountries[0] === viewer;
  return { domestic, viewerCountry: viewer, destinationCountries, addresses: addresses.length, resolved };
}
