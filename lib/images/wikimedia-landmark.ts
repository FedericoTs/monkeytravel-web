import type { SupabaseClient } from "@supabase/supabase-js";
import { commonsFiles, isUsablePhoto, storePhoto, wiki, WIKIDATA_API, type CommonsFile } from "@/lib/images/wikimedia";

/**
 * An activity's photo from Wikimedia Commons, when Wikidata knows the place: an
 * item with an image, near the activity, that has the activity's name in some
 * language. A wrong photo is worse than none, so the name must match closely
 * and the item must not be another kind of thing (the square's hotel, the
 * shrine's station).
 */

export interface LandmarkQuery {
  /** The names the place goes by: Google's, the activity's. */
  names: string[];
  lat: number;
  lng: number;
  /** A meal or a drink: the later parts of its name say where it is ("Afuri Ramen (Harajuku)"). */
  meal?: boolean;
}

const RADIUS_M = 1500;
/** Stored widths: cards show the first, the activity sheet the second. */
export const LANDMARK_WIDTHS = [500, 960];
// Wider than the largest stored width, so Commons scales every copy down.
const MIN_WIDTH = 1000;
// The item's own image, then its panoramic, night, aerial and interior views.
const IMAGE_PROPERTIES = ["P18", "P4291", "P3451", "P8592", "P5775"];
const LANGUAGES = "en|mul|fr|es|it|pt|de|ca|nl|ja|el|hu|cs|pl|tr|id|ko|zh";
// Instances of these are not sights: stops and stations, airports, hotels, companies.
const NOT_A_SIGHT = new Set(["Q953806", "Q2175765", "Q928830", "Q55488", "Q1248784", "Q644371", "Q27686", "Q783794", "Q4830453", "Q6881511", "Q891723"]);

const STOP = new Set(
  "the of and a an at in on to by de du des la le les l d el los las il lo gli di da do dos das del della delle dei al y e et und der die das van von"
    .split(" "),
);
// What an activity name says besides the place: "Lunch at Katz's Delicatessen".
const ACTIVITY_WORDS =
  /^((romantic|farewell|welcome|quick|late|early|relaxing|guided|self-guided)\s+)*(visit|explore|discover|see|walk|stroll|wander|hike|tour|lunch|dinner|breakfast|brunch|drinks|coffee|picnic|sunset|sunrise|evening|morning|afternoon|day trip|shopping)\s+(at|to|in|on|around|through|along|of|the)?\s*/i;

// Words for a kind of place, in the languages place names come in, folded to
// one word per kind so "Museu Picasso" and "Picasso Museum" agree.
const KIND_WORDS: Record<string, string[]> = {
  museum: ["museum", "museo", "museu", "musee", "muzeum"],
  gallery: ["gallery", "galleria", "galeria", "galerie", "pinacoteca", "pinakothek"],
  park: ["park", "parque", "parc", "parco"],
  garden: ["garden", "jardin", "jardim", "giardino", "garten", "gyoen"],
  temple: ["temple", "templo", "tempio", "pura", "wat"],
  shrine: ["shrine", "jinja", "jingu", "santuario", "sanctuaire"],
  church: ["church", "iglesia", "chiesa", "eglise", "igreja", "kirche", "esglesia", "kerk"],
  cathedral: ["cathedral", "catedral", "cattedrale", "kathedrale", "duomo"],
  basilica: ["basilica", "basilique", "basilika"],
  chapel: ["chapel", "capilla", "cappella", "chapelle", "kapelle", "capela"],
  mosque: ["mosque", "mezquita", "moschea", "mosquee", "camii", "masjid"],
  monastery: ["monastery", "monasterio", "mosteiro", "monastero", "kloster", "abbey", "abadia", "abbazia", "abbaye", "convent", "convento"],
  market: ["market", "mercado", "mercato", "marche", "mercat", "markt", "bazaar", "bazar", "ichiba", "shopping"],
  palace: ["palace", "palacio", "palazzo", "palais", "palau", "palast"],
  castle: ["castle", "castillo", "castello", "chateau", "castelo", "schloss", "burg"],
  fortress: ["fortress", "fortaleza", "fortezza", "forteresse", "fort", "citadel", "alcazaba"],
  tower: ["tower", "torre", "tour", "turm"],
  bridge: ["bridge", "puente", "ponte", "pont", "brucke"],
  square: ["square", "plaza", "piazza", "praca", "placa", "platz", "plein", "namesti"],
  street: ["street", "calle", "rua", "rue", "carrer", "strasse", "avenue", "avenida", "boulevard", "road", "lane", "alley", "dori", "promenade", "paseo", "passeig"],
  beach: ["beach", "playa", "praia", "spiaggia", "plage", "strand"],
  lake: ["lake", "lago", "lac"],
  mountain: ["mount", "mountain", "monte", "mont", "berg"],
  viewpoint: ["viewpoint", "mirador", "miradouro", "belvedere", "lookout", "observatory", "observation", "deck"],
  quarter: ["quarter", "district", "barrio", "bairro", "quartier", "quartiere", "neighborhood", "neighbourhood"],
  fountain: ["fountain", "fuente", "fontana", "fontaine", "brunnen", "font"],
  theatre: ["theatre", "theater", "teatro", "opera"],
  amphitheatre: ["amphitheatre", "amphitheater", "anfiteatro", "amphitheatrum"],
  stadium: ["stadium", "estadio", "stadio", "stade", "stadion"],
  baths: ["bath", "terme", "terma", "therme", "thermae"],
  cemetery: ["cemetery", "cementerio", "cimitero", "cemiterio", "cimetiere", "friedhof"],
  library: ["library", "biblioteca", "bibliotheque", "bibliothek"],
  synagogue: ["synagogue", "sinagoga", "synagoge"],
  gate: ["gate", "puerta", "porta", "porte"],
  wall: ["wall", "muralla", "mura", "muralha", "muraille"],
  island: ["island", "isla", "isola", "ilha"],
  house: ["house", "casa", "maison", "haus"],
  hall: ["hall"],
  restaurant: ["restaurant", "restaurante", "ristorante", "trattoria", "osteria", "taverna", "tavern", "bistro", "brasserie", "cafe", "bar", "pizzeria"],
};
const KIND = new Map(Object.entries(KIND_WORDS).flatMap(([kind, words]) => words.map((w) => [w, kind] as const)));
const isKind = (t: string) => t in KIND_WORDS;
// On the item's name only, these make it another thing than the activity.
const OTHER_THING = new Set(
  "hotel hostel apartment suite station estacion stazione gare bahnhof airport aeropuerto aeroporto aeroport terminal metro subway stop memorial statue relief plaque grave tomb bust sculpture painting company corporation".split(" "),
);

/** A name as comparable words: accents, punctuation, plurals and small words out; kinds of place folded. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .map((t) => KIND.get(t) ?? t);
}

/**
 * The ways an activity can name its place: whole, without "Lunch at", and its
 * parts ("A | B", "A (B)"). A meal's later parts name where it is ("Afuri
 * Ramen (Harajuku)"), so a meal keeps its first part only.
 */
export function nameVariants(names: string[], meal = false): string[] {
  const out: string[] = [];
  for (const name of names) {
    const bare = name.replace(ACTIVITY_WORDS, "");
    // A part that is only kinds of place ("Restaurant") names nothing.
    const parts = bare.split(/\s+[|–—-]\s+|\s*\|\s*|\s*&\s*|[()]/).filter((p) => nameTokens(p).some((t) => !isKind(t)));
    for (const n of [name, bare, ...(meal ? parts.slice(0, 1) : parts)]) {
      const v = n.trim();
      if (v && !out.includes(v) && nameTokens(v).some((t) => !isKind(t))) out.push(v);
    }
  }
  return out;
}

/**
 * How well an item's name matches the activity's: 0 when it may be another
 * place, up to 2 for the same words. Most of the activity's words must be in
 * the item's name, and any other word on the item's must be a kind of place
 * of the same kind ("Yanaka Ginza Shopping Street" for "Yanaka Ginza", but not
 * "Times Square Ball" for "Times Square").
 */
export function nameMatch(activity: string[], item: string[]): number {
  const a = new Set(activity);
  const b = new Set(item);
  if (!a.size || !b.size) return 0;
  if ([...b].some((t) => OTHER_THING.has(t) && !a.has(t))) return 0;
  if (activity.join("") === item.join("")) return 2;
  const common = [...a].filter((t) => b.has(t)).length;
  const aCover = common / a.size;
  const bCover = common / b.size;
  if (aCover < 0.66) return 0;
  const kindsA = [...a].filter(isKind);
  const kindsB = [...b].filter(isKind);
  if (kindsA.length && kindsB.length && !kindsA.some((k) => b.has(k))) return 0;
  // A kind on the item's name that the activity's lacks makes it the place
  // next door: the bridge's museum, or, while one of the activity's words is
  // still unmatched, the theatre beside an "Ancient Odeon" (a kind this list
  // doesn't know).
  if (kindsB.some((k) => !a.has(k)) && (kindsA.length > 0 || common < a.size)) return 0;
  if (bCover < 0.75 && [...b].some((t) => !a.has(t) && !isKind(t))) return 0;
  return aCover + bCover;
}

/**
 * The place a Google name names: its first part, as the rest says where it is
 * or what it offers ("Tablao Flamenco Cordobes | Barcelona", "Hamdi Restaurant
 * - Eminönü").
 */
export function placeName(name: string): string {
  return name.split(/\s*\|\s*|\s+[–—-]\s+/).find((p) => nameTokens(p).some((t) => !isKind(t)))?.trim() ?? name;
}

/**
 * Whether two names can be the same place: a word in common, spelled alike or
 * not. Google's name for an activity is only lent when it agrees with the
 * activity's.
 */
export function namesAgree(a: string, b: string): boolean {
  const tokens = (n: string) => nameTokens(n.replace(ACTIVITY_WORDS, "")).filter((t) => t.length > 2);
  const own = (t: string[]) => t.filter((w) => !isKind(w));
  let [ta, tb] = [tokens(a), tokens(b)];
  // Kinds of place count only when a name has nothing else ("Castle District").
  if (own(ta).length && own(tb).length) [ta, tb] = [own(ta), own(tb)];
  return ta.some((x) => tb.some((y) => wordsAlike(x, y)));
}

/** The same word, or two starting alike or a letter apart: "Colosseo" and "Colosseum", "Jemaa" and "Djemaa". */
function wordsAlike(x: string, y: string): boolean {
  if (x === y) return true;
  if (x.length < 4 || y.length < 4) return false;
  if (x.slice(0, 4) === y.slice(0, 4)) return true;
  if (x.length < 5 || y.length < 5 || Math.abs(x.length - y.length) > 1) return false;
  let i = 0;
  while (x[i] === y[i]) i++;
  return x.slice(i + 1) === y.slice(i + 1) || x.slice(i + 1) === y.slice(i) || x.slice(i) === y.slice(i + 1);
}

/** Metres between two points. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const x = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(x));
}

interface Labelled {
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
}

interface Snak {
  mainsnak?: { datavalue?: { value?: unknown } };
}

/** An item's best match among the activity's names; a label beats an alias. */
export function itemMatch(variants: string[], item: Labelled): number {
  const labels = Object.values(item.labels ?? {}).map((l) => l.value);
  const aliases = Object.values(item.aliases ?? {}).flat().map((a) => a.value);
  let best = 0;
  for (const v of variants.map(nameTokens)) {
    for (const l of labels) best = Math.max(best, nameMatch(v, nameTokens(l)));
    for (const al of aliases) best = Math.max(best, nameMatch(v, nameTokens(al)) - 0.01);
  }
  return best;
}

async function searchItems(text: string, q: LandmarkQuery, signal: AbortSignal): Promise<string[]> {
  const d = (await wiki(
    WIKIDATA_API,
    {
      action: "query",
      list: "search",
      srnamespace: 0,
      srlimit: 20,
      // The radius must be whole metres: a decimal one silently drops the filter.
      srsearch: `${text} haswbstatement:P18 nearcoord:${RADIUS_M}m,${q.lat.toFixed(5)},${q.lng.toFixed(5)}`,
    },
    signal,
  )) as { query?: { search?: { title: string }[] } };
  return (d.query?.search ?? []).map((s) => s.title);
}

async function entities(ids: string[], props: string, signal: AbortSignal): Promise<Record<string, Labelled & { claims?: Record<string, Snak[]> }>> {
  if (!ids.length) return {};
  const d = (await wiki(WIKIDATA_API, { action: "wbgetentities", ids: ids.join("|"), props, languages: LANGUAGES }, signal)) as {
    entities?: Record<string, Labelled & { claims?: Record<string, Snak[]> }>;
  };
  return d.entities ?? {};
}

/** The Commons photo of the place the activity names, or null when Wikidata has no usable one. */
export async function findLandmarkPhoto(q: LandmarkQuery, signal: AbortSignal): Promise<CommonsFile | null> {
  const variants = nameVariants(q.names, q.meal);
  if (!variants.length) return null;
  // All of the name's words first; any of them when that finds nothing named alike.
  let ranked: { id: string; score: number }[] = [];
  for (const any of [false, true]) {
    const ids = new Set<string>();
    for (const v of variants.slice(0, 2)) {
      const words = v.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter((w) => w.length > 1 && !STOP.has(w.toLowerCase()));
      if (!words.length || (any && words.length < 2)) continue;
      for (const id of await searchItems(words.join(any ? " OR " : " "), q, signal)) ids.add(id);
    }
    const items = await entities([...ids].slice(0, 20), "labels|aliases", signal);
    ranked = Object.entries(items)
      .map(([id, item]) => ({ id, score: itemMatch(variants, item) }))
      .filter((r) => r.score > 0)
      .sort((x, y) => y.score - x.score);
    if (ranked.length) break;
  }
  // The best-named item near the activity that is a sight; nothing else is the place.
  for (const { id, score } of ranked.slice(0, 2)) {
    if (score < ranked[0].score) break;
    const claims = (await entities([id], "claims", signal))[id]?.claims ?? {};
    const at = claims.P625?.[0]?.mainsnak?.datavalue?.value as { latitude?: number; longitude?: number } | undefined;
    if (typeof at?.latitude !== "number" || typeof at.longitude !== "number") continue;
    if (distanceM(q.lat, q.lng, at.latitude, at.longitude) > RADIUS_M) continue;
    const kinds = (claims.P31 ?? []).map((c) => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id);
    if (kinds.some((k) => k && NOT_A_SIGHT.has(k))) continue;
    // A meal is never the town or district it is in, which has a population:
    // "Ciudad Condal" is also Barcelona, whose photo is the Sagrada Família.
    if (q.meal && claims.P1082?.length) continue;
    const names = IMAGE_PROPERTIES.flatMap((p) => (claims[p] ?? []).map((c) => c.mainsnak?.datavalue?.value)).filter(
      (n): n is string => typeof n === "string",
    );
    const files = await commonsFiles([...new Set(names)].slice(0, 8), signal, LANDMARK_WIDTHS[1]);
    return files.find((f) => isUsablePhoto(f, MIN_WIDTH)) ?? null;
  }
  return null;
}

/** Finds and stores the activity's photo; the served URL (card width, credit attached), or null. */
export async function buildLandmarkPhoto(db: SupabaseClient, q: LandmarkQuery, signal: AbortSignal): Promise<string | null> {
  const photo = await findLandmarkPhoto(q, signal);
  if (!photo) return null;
  const [card] = await storePhoto(db, photo, LANDMARK_WIDTHS, signal);
  return card;
}
