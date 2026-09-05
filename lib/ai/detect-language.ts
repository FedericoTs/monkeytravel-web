/**
 * Which of our four languages a piece of itinerary text is written in.
 *
 * Stopword scoring, nothing cleverer: itinerary descriptions are full
 * sentences, and a day carries a few hundred words, so function words
 * separate en/es/it/pt reliably. Proper nouns ("Museo del Prado") are
 * deliberately not decisive — they appear in every language's text.
 *
 * Used by the trip-locale backfill (scripts/backfill-trip-locale.mts) to
 * find days whose language does not match the rest of the trip, and to
 * stamp trip_meta.locale on trips created before it existed. Live Trip
 * plan, Phase 1.3.
 */
import { AI_LANGUAGES, type SupportedLanguage } from "./language";

const STOPWORDS: Record<SupportedLanguage, readonly string[]> = {
  en: [
    "the", "and", "of", "to", "in", "with", "for", "your", "at", "is", "from", "this",
    "on", "an", "by", "or", "as", "you", "it", "its", "are", "be", "that", "will",
    "can", "where", "then", "before", "after", "through", "while", "enjoy", "visit",
    "explore", "stroll", "walk", "take", "head", "local", "one", "day", "morning",
    "afternoon", "evening", "lunch", "dinner", "breakfast", "views", "known",
  ],
  es: [
    "el", "la", "los", "las", "de", "del", "y", "en", "con", "para", "por", "un",
    "una", "es", "al", "su", "sus", "que", "se", "este", "esta", "donde", "desde",
    "hasta", "más", "también", "disfruta", "visita", "explora", "antes", "después",
    "mientras", "luego", "recorre", "pasea", "descubre", "mañana", "tarde", "noche",
    "almuerzo", "cena", "desayuno", "vistas", "conocido", "famoso", "ciudad",
  ],
  it: [
    "il", "lo", "la", "gli", "le", "di", "del", "della", "dei", "delle", "e", "ed",
    "in", "con", "per", "un", "una", "è", "al", "alla", "che", "si", "questo",
    "questa", "dove", "da", "più", "anche", "poi", "prima", "dopo", "mentre",
    "visita", "esplora", "goditi", "scopri", "passeggia", "passeggiata", "tra",
    "nel", "nella", "sul", "sulla", "mattina", "pomeriggio", "sera", "pranzo",
    "cena", "colazione", "vista", "famoso", "città",
  ],
  pt: [
    "o", "os", "as", "de", "do", "da", "dos", "das", "e", "em", "com", "para", "por",
    "um", "uma", "é", "ao", "à", "no", "na", "nos", "nas", "que", "se", "este",
    "esta", "onde", "mais", "também", "antes", "depois", "enquanto", "visite",
    "explore", "aproveite", "descubra", "passeie", "passeio", "pelo", "pela",
    "manhã", "tarde", "noite", "almoço", "jantar", "café", "vistas", "famoso",
    "cidade", "você", "não",
  ],
};

const SETS: Record<SupportedLanguage, Set<string>> = Object.fromEntries(
  AI_LANGUAGES.map((l) => [l, new Set(STOPWORDS[l])]),
) as Record<SupportedLanguage, Set<string>>;

export interface LanguageGuess {
  /** null when the text is too short or no language clearly leads. */
  language: SupportedLanguage | null;
  /** stopword hits per language, divided by the token count */
  scores: Record<SupportedLanguage, number>;
  tokens: number;
}

const MIN_TOKENS = 8;
const MIN_SCORE = 0.06;
const MIN_LEAD = 0.15; // the leader must beat the runner-up by 15% of its own score

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}'’-]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function detectLanguage(text: string): LanguageGuess {
  const tokens = tokenize(text);
  const scores = Object.fromEntries(AI_LANGUAGES.map((l) => [l, 0])) as Record<SupportedLanguage, number>;
  if (tokens.length < MIN_TOKENS) return { language: null, scores, tokens: tokens.length };
  for (const tok of tokens) {
    for (const l of AI_LANGUAGES) if (SETS[l].has(tok)) scores[l] += 1;
  }
  for (const l of AI_LANGUAGES) scores[l] = scores[l] / tokens.length;
  const ranked = [...AI_LANGUAGES].sort((a, b) => scores[b] - scores[a]);
  const [top, second] = ranked;
  const lead = scores[top] > 0 ? (scores[top] - scores[second]) / scores[top] : 0;
  const language = scores[top] >= MIN_SCORE && lead >= MIN_LEAD ? top : null;
  return { language, scores, tokens: tokens.length };
}

/** Text fields that carry prose; names and place strings are kept out on purpose. */
const DAY_TEXT_KEYS = ["title", "theme", "summary", "description", "notes", "tips", "why"];
const ACTIVITY_TEXT_KEYS = ["description", "tips", "notes", "why", "booking_note"];

/**
 * The prose of one itinerary day: day-level text plus every activity's
 * description-like fields. Activity names and locations are excluded — a
 * Portuguese trip still says "Mosteiro dos Jerónimos".
 */
export function itineraryDayText(day: unknown): string {
  if (!day || typeof day !== "object") return "";
  const d = day as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of DAY_TEXT_KEYS) if (typeof d[k] === "string") parts.push(d[k] as string);
  const activities = Array.isArray(d.activities) ? d.activities : [];
  for (const a of activities) {
    if (!a || typeof a !== "object") continue;
    const act = a as Record<string, unknown>;
    for (const k of ACTIVITY_TEXT_KEYS) if (typeof act[k] === "string") parts.push(act[k] as string);
  }
  return parts.join(" \n ");
}
