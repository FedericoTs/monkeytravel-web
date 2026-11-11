/**
 * The activities a reply keeps and the ones it takes out, told apart by name: the
 * model rewrites whole days and sometimes renames what it kept.
 */

import type { Activity, ItineraryDay } from "@/types";
import { normalizeActivityType } from "@/lib/trip/activity-type";
import type { DayEdit } from "./edit-validation";

// Words too common in activity names to tell two places apart.
const GENERIC_WORDS = new Set([
  "explore", "explorar", "esplora", "explorando", "exploration", "visit", "visita", "visitar", "lunch", "dinner",
  "breakfast", "brunch", "almuerzo", "comida", "cena", "desayuno", "pranzo", "colazione", "almoco", "jantar", "tour",
  "walk", "stroll", "paseo", "passeggiata", "passeio", "the", "and", "del", "della", "delle", "with", "con", "com",
  "around", "near", "free", "time",
]);
export const nameTokens = (name: string): string[] => [
  ...new Set(
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 3 && !GENERIC_WORDS.has(t)),
  ),
];

// Words many places share ("Oxford Street" and "Broadwick Street", "Piazza
// Navona"), in the four languages, written as nameTokens leaves them.
const PLACE_KIND_WORDS = new Set([
  "street", "road", "avenue", "lane", "square", "plaza", "market", "markets", "museum", "park", "garden", "gardens",
  "church", "cathedral", "palace", "bridge", "tower", "beach", "gallery", "castle", "temple", "shrine", "station",
  "hall", "house", "centre", "center", "old", "town", "city", "village", "island", "lake", "river", "bay", "harbour",
  "harbor", "port", "quarter", "district", "neighborhood", "neighbourhood", "hill", "fort", "fortress", "abbey",
  "chapel", "basilica", "mosque", "mall", "theatre", "theater", "library", "zoo", "aquarium", "national", "royal",
  "central", "grand", "great", "restaurant", "cafe", "bar", "pub", "bakery", "saint", "san", "santa", "santo", "sant",
  "sao", "calle", "avenida", "mercado", "museo", "parque", "jardin", "jardines", "iglesia", "catedral", "palacio",
  "puente", "torre", "playa", "galeria", "castillo", "templo", "estacion", "casa", "centro", "barrio", "mirador",
  "lago", "rio", "puerto", "monasterio", "teatro", "biblioteca", "ciudad", "pueblo", "isla", "viejo", "vieja",
  "antiguo", "antigua", "nacional", "real", "gran", "grande", "restaurante", "cafeteria", "panaderia", "via",
  "viale", "piazza", "mercato", "parco", "giardino", "giardini", "chiesa", "duomo", "cattedrale", "palazzo", "ponte",
  "spiaggia", "galleria", "castello", "tempio", "stazione", "quartiere", "belvedere", "fiume", "porto", "monastero",
  "citta", "borgo", "isola", "vecchio", "vecchia", "antico", "antica", "nazionale", "reale", "ristorante",
  "trattoria", "osteria", "pasticceria", "gelateria", "rua", "praca", "museu", "jardim", "igreja", "castelo", "praia",
  "estacao", "bairro", "miradouro", "mosteiro", "cidade", "vila", "ilha", "velho", "velha", "antigo", "padaria",
  "pastelaria", "los", "las", "les", "dos", "das", "der", "die", "des", "von",
]);

/**
 * A name's own words: not ones many places share, nor the words of the trip's
 * place ("Chinatown London" on a London trip is "chinatown"). [] for a name made
 * of those only ("Tower of London"), which only the whole name names.
 */
export function ownWords(name: string, place = ""): string[] {
  const where = nameTokens(place);
  return nameTokens(name).filter((w) => !PLACE_KIND_WORDS.has(w) && !where.some((p) => sameWord(w, p)));
}

/** One letter added, dropped or changed: "catedral" and "cathedral". */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** The same word, or its form in another language ("museo", "museum"). */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (short < 5) return false;
  let p = 0;
  while (p < short && a[p] === b[p]) p++;
  return (p >= 4 && p >= 0.6 * short) || oneEditApart(a, b);
}

/**
 * The model rewrites whole days and sometimes renames what it kept (it
 * translated "Explore Plaza Botero…" for a Spanish reader). A returned
 * activity with a saved one's name, or most of its words and none of its own,
 * stays the saved activity at its new time; "Guided tour of…" is a change.
 * A meal is never taken for a sight by its words: "Almuerzo en la Ribeira"
 * became a second "Ribeira walk", and the lunch was lost.
 */
const MEAL_TYPES = new Set(["restaurant", "cafe", "bar", "food", "market"]);
const isMeal = (a: Activity) => MEAL_TYPES.has(normalizeActivityType(a.type, a.name));

/** A returned activity scoring this much against a saved one is that one. */
export const SAME_ACTIVITY = 0.6;

/**
 * How surely a returned activity is a saved one: 2 under the same name, else
 * the share of the saved name's words it has, when it has no words of its own
 * and isn't a meal for a sight or a sight for a meal.
 */
export function sameActivityScore(saved: Activity, returned: Activity): number {
  if (saved.name.trim().toLowerCase() === returned.name.trim().toLowerCase()) return 2;
  const mine = nameTokens(returned.name);
  const theirs = nameTokens(saved.name);
  if (!mine.length || isMeal(saved) !== isMeal(returned) || !mine.every((t) => theirs.some((u) => sameWord(t, u)))) return 0;
  return theirs.filter((u) => mine.some((t) => sameWord(t, u))).length / theirs.length;
}

export function keepSavedActivities(
  days: ItineraryDay[],
  edits: DayEdit[],
  talk: { reply?: string; message?: string } = {},
): DayEdit[] {
  const saved = days.flatMap((d) =>
    (Array.isArray(d.activities) ? d.activities : []).filter((a) => typeof a?.name === "string" && a.name.trim()),
  );
  const said = nameTokens(`${talk.reply ?? ""} ${talk.message ?? ""}`);
  const asked = nameTokens(talk.message ?? "").filter((t) => t.length >= 5);
  const used = new Set<Activity>();
  return edits.map((e) => ({
    ...e,
    activities: e.activities.map((n) => {
      let best: { a: Activity; score: number } | null = null;
      for (const s of saved) {
        if (used.has(s)) continue;
        const score = sameActivityScore(s, n);
        if (score >= SAME_ACTIVITY && (!best || score > best.score)) best = { a: s, score };
      }
      if (!best) return n;
      const kept = best.a;
      used.add(kept);
      // Its note for this request stays when the reply or the request names
      // the activity, or the note echoes the request ("vegetarian options").
      const noted =
        nameTokens(kept.name).some((t) => said.some((w) => sameWord(t, w))) ||
        nameTokens(n.description ?? "").some((t) => asked.some((w) => sameWord(t, w)));
      return {
        ...kept,
        ...(noted && { description: n.description || kept.description, tips: n.tips?.length ? n.tips : kept.tips }),
        time_slot: n.time_slot,
        start_time: n.start_time,
        duration_minutes: n.duration_minutes,
      };
    }),
  }));
}

/**
 * Activities of the edited days that leave the trip. Not taken out: one moved
 * to another edited day, one still on a day left as it was (a repeat), or one
 * whose every word is in the new names (split in two, or reworded).
 */
export function takenOut(days: ItineraryDay[], edits: DayEdit[]): string[] {
  const key = (a: { name?: unknown }) => (typeof a?.name === "string" ? a.name.trim().toLowerCase() : "");
  const kept = new Set(edits.flatMap((e) => e.activities.map(key)));
  const edited = new Set(edits.map((e) => e.day_number));
  const elsewhere = new Set(days.filter((d) => !edited.has(d.day_number)).flatMap((d) => (d.activities ?? []).map(key)));
  const words = edits.flatMap((e) => e.activities.flatMap((a) => nameTokens(a.name)));
  const reworded = (name: string) => {
    const mine = nameTokens(name);
    return mine.length > 0 && mine.every((t) => words.some((w) => sameWord(t, w)));
  };
  return days
    .filter((d) => edited.has(d.day_number))
    .flatMap((d) => (Array.isArray(d.activities) ? d.activities : []))
    .filter((a) => key(a) && !kept.has(key(a)) && !elsewhere.has(key(a)) && !reworded(a.name))
    .map((a) => a.name);
}
