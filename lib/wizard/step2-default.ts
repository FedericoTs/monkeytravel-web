import type { TripIntent } from "@/lib/posthog/events";
import type { TripVibe } from "@/types";

/**
 * The two styles step 2 starts with when the planner has picked none, from what travellers chose for the same kind
 * of place and the same company when nothing was chosen for them. Never empty, unlike the season's suggestions,
 * several of which step 2 doesn't offer.
 */

export type PlaceKind = "city" | "route" | "country" | "nature" | "beach";

/** Well-known places people go to mostly for the sea. */
const BEACH =
  /\b(playa del carmen|canc[uú]n|tulum|riviera maya|isla mujeres|cozumel|holbox|bali|canggu|seminyak|uluwatu|kuta|nusa (?:dua|penida|lembongan)|gili|phuket|krabi|ao nang|koh (?:samui|phangan|tao|lanta|phi phi|chang)|ko (?:samui|phangan|tao|lanta)|langkawi|boracay|el nido|palawan|maldives|mald[ií]vas|maldive|mauritius|maurice|seychelles|zanzibar|goa|punta cana|los cabos|cabo san lucas|puerto vallarta|mazatl[aá]n|mykonos|santorini|ibiza|mallorca|majorca|menorca|tenerife|gran canaria|lanzarote|fuerteventura|algarve|albufeira|hvar|corfu|zakynthos|rhodes|bodrum|fethiye|sharm el.?sheikh|hurghada|dahab|diani|boa vista|florian[oó]polis|b[uú]zios|porto de galinhas|macei[oó]|fernando de noronha|jericoacoara|san andr[eé]s|tamarindo|maui|oahu|o['‘’]ahu|waikiki|honolulu|aruba|cura[cç]ao|barbados|montego bay|negril|nassau|bahamas|sardinia|sardegna|cerde[nñ]a|costa smeralda|marbella|benidorm|varadero|amalfi|positano|capri|cinque terre|madeira|azores|a[cç]ores|hawaii|fiji|bora bora|tahiti|caribbean|caribe|jamaica|cabo verde|cape verde|key west|miami beach|gold coast|byron bay|whitsunday|da nang|nha trang|phu quoc|isla|ilha|isola|island|beach|playa|praia|plage|spiaggia)\b/i;

/** Places people go to mostly for the outdoors: parks, mountains, lakes, wild regions. */
const NATURE =
  /\b(national park|parque nacional|parco nazionale|alps|alpes|alpi|dolomit\w*|patagonia|banff|jasper|yosemite|yellowstone|zion|grand canyon|sedona|lake district|highlands|cappadocia|capadocia|safari|serengeti|kruger|masai mara|maasai mara|torres del paine|atacama|lapland|lapponia|laponia|rovaniemi|troms[øo]|lofoten|fjord\w*|interlaken|zermatt|chamonix|grindelwald|lauterbrunnen|lake como|lago di como|lago di garda|lake garda|bled|plitvice|tatra|pyrenees|pirineos|picos de europa|smoky mountains|rocky mountains|amazon\w*|amaz[oô]nia|gal[aá]pagos|iguaz[uú]|igua[cç]u|uluru|milford sound|queenstown|wanaka|fiordland|monteverde|la fortuna|arenal|sapa|ha giang|halong|ha long|munnar|kerala|ladakh|leh|darjeeling|rishikesh|manali|shimla|kasol|coorg|ooty|nainital|mussoorie|cotswolds|tuscany|toscana|provence|douro|isle of skye|skye|faroe|madagascar|sahara|merzouga|wadi rum|chiang rai)\b/i;

/** Countries whose trips are mostly the outdoors, in the four languages. */
const NATURE_COUNTRY =
  /^(iceland|islandia|islanda|isl[aâ]ndia|norway|noruega|norvegia|new zealand|nueva zelanda|nuova zelanda|nova zel[aâ]ndia|costa rica)$/i;

let regionNames: Set<string> | null = null;

/** Every country's name in the four languages, lower case. */
function countries(): Set<string> {
  if (regionNames) return regionNames;
  const names = new Set<string>(["usa", "uk", "united states", "england", "scotland", "wales", "holland", "vietnam", "turkey", "korea", "uae"]);
  try {
    const codes: string[] = [];
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) codes.push(String.fromCharCode(a, b));
    for (const lang of ["en", "es", "it", "pt"]) {
      const display = new Intl.DisplayNames([lang], { type: "region" });
      for (const code of codes) {
        try {
          const name = display.of(code);
          if (name && name !== code) names.add(name.toLowerCase());
        } catch {
          // Not a region code.
        }
      }
    }
  } catch {
    // No Intl.DisplayNames here: the short list above stands.
  }
  regionNames = names;
  return names;
}

/** What kind of place a trip is to, from what was typed or picked and whether it is a route. */
export function placeKind(destination: string, route: boolean): PlaceKind {
  const text = destination.trim();
  if (route || / & /.test(text)) return "route";
  const parts = text.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const first = parts[0] ?? "";
  if (NATURE_COUNTRY.test(first)) return "nature";
  if (parts.length === 1 && countries().has(first)) return "country";
  if (BEACH.test(text)) return "beach";
  if (NATURE.test(text)) return "nature";
  if (countries().has(first)) return "country";
  return "city";
}

/** By kind of place, the two most chosen styles. */
const BY_KIND: Record<PlaceKind, [TripVibe, TripVibe]> = {
  city: ["cultural", "foodie"],
  route: ["cultural", "nature"],
  country: ["urban", "foodie"],
  nature: ["nature", "adventure"],
  beach: ["cultural", "foodie"],
};

/** Where who's coming changes them, with enough trips to say so. */
const BY_WHO: Partial<Record<`${TripIntent}:${PlaceKind}`, [TripVibe, TripVibe]>> = {
  "couple:city": ["cultural", "romantic"],
  "couple:route": ["cultural", "romantic"],
  "solo:city": ["adventure", "cultural"],
  "solo:country": ["urban", "cultural"],
  "group:beach": ["foodie", "urban"],
};

/** Step 2's two styles to start with. */
export function step2Default(who: TripIntent | null | undefined, kind: PlaceKind): TripVibe[] {
  return [...((who ? BY_WHO[`${who}:${kind}`] : undefined) ?? BY_KIND[kind])];
}
