import type { TripVibe } from "@/types";

/**
 * A trip described in one sentence ("5 days in Lisbon in March, food and
 * history"), read into the wizard's fields. Rule-based and local: it runs on
 * every keystroke at no cost, and the visitor sees what it read before
 * anything is planned. What it can't read is left to the defaults.
 *
 * English, Italian, Spanish and Portuguese, the wizard's languages.
 */
export interface TripSentence {
  /** The place, as typed; several places are joined with " & ". "" when none. */
  destination: string;
  /** Trip length in days, 2..MAX_DAYS, or null when not said. */
  days: number | null;
  /** 1..12, or null when not said. */
  month: number | null;
  /** The wizard's canonical vibes, at most three. */
  vibes: TripVibe[];
  intent: "solo" | "group" | null;
  budget: "budget" | "luxury" | null;
}

const MAX_DAYS = 14;

const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.+$/, "");

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  um: 1, uma: 1, dois: 2, duas: 2, quatro: 4, sete: 7, oito: 8, dez: 10,
};
const DAY_WORDS = new Set(["day", "days", "giorno", "giorni", "dia", "dias", "jornada", "jornadas"]);
const NIGHT_WORDS = new Set(["night", "nights", "notte", "notti", "noche", "noches", "noite", "noites"]);
const WEEK_WORDS = new Set(["week", "settimana", "semana"]);
const WEEKS_WORDS = new Set(["weeks", "settimane", "semanas"]);

const MONTHS: Record<string, number> = {};
[
  ["january", "gennaio", "enero", "janeiro"],
  ["february", "feb", "febbraio", "febrero", "fevereiro"],
  ["march", "marzo", "marco"],
  ["april", "apr", "aprile", "abril"],
  ["may", "maggio", "mayo", "maio"],
  ["june", "giugno", "junio", "junho"],
  ["july", "luglio", "julio", "julho"],
  ["august", "aug", "agosto"],
  ["september", "sep", "sept", "settembre", "septiembre", "setiembre", "setembro"],
  ["october", "oct", "ottobre", "octubre", "outubro"],
  ["november", "nov", "novembre", "noviembre", "novembro"],
  ["december", "dec", "dicembre", "diciembre", "dezembro"],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

/** Words that only lead into a month: "in March", "a marzo", "early April". */
const MONTH_LEAD = new Set(["in", "during", "next", "early", "mid", "late", "a", "ad", "di", "nel", "en", "em", "de", "no", "na", "inizio", "fine", "principios", "finales", "comeco", "final"]);
/** Month names that are also ordinary words or names ("may", San Marco): a month only after a lead word. */
const AMBIGUOUS_MONTHS = new Set(["may", "marco"]);

const VIBE_WORDS: Record<string, TripVibe> = {};
const vibe = (v: TripVibe, words: string[]) => words.forEach((w) => (VIBE_WORDS[w] = v));
vibe("foodie", ["food", "foodie", "eat", "eating", "cuisine", "restaurants", "culinary", "wine", "cibo", "mangiare", "gastronomia", "vino", "comida", "comer", "gastronomico", "vinho"]);
vibe("cultural", ["history", "historic", "historical", "culture", "cultural", "museums", "museum", "art", "architecture", "storia", "cultura", "musei", "arte", "architettura", "historia", "museos", "arquitectura", "museus", "arquitetura"]);
vibe("nature", ["nature", "hiking", "hike", "mountains", "beach", "beaches", "parks", "outdoors", "natura", "montagna", "montagne", "mare", "spiaggia", "escursioni", "naturaleza", "montana", "playa", "playas", "senderismo", "natureza", "montanha", "praia", "praias", "trilhas"]);
vibe("romantic", ["romantic", "honeymoon", "romantico", "romantica", "romance", "romantique"]);
vibe("adventure", ["adventure", "adventurous", "avventura", "aventura", "sports", "sport"]);
vibe("urban", ["nightlife", "shopping", "bars", "clubs", "nightclubs", "movida", "compras"]);

/** People who make a trip romantic: "with my girlfriend". */
const PARTNER_WORDS = new Set(["partner", "girlfriend", "boyfriend", "wife", "husband", "fiance", "fiancee", "spouse", "fidanzata", "fidanzato", "ragazza", "ragazzo", "compagna", "compagno", "moglie", "marito", "novia", "novio", "pareja", "esposa", "esposo", "namorada", "namorado", "mulher", "marido", "companheiro", "companheira"]);
const GROUP_WORDS = new Set(["friends", "family", "kids", "children", "group", "amici", "famiglia", "bambini", "figli", "amigos", "amigas", "familia", "ninos", "hijos", "filhos", "criancas"]);
const SOLO_WORDS = new Set(["solo", "alone", "myself", "sola", "solitario", "solitaria", "sozinho", "sozinha"]);
const WITH_WORDS = new Set(["with", "con", "com"]);
const POSSESSIVES = new Set(["my", "our", "mio", "mia", "miei", "mie", "il", "la", "i", "gli", "le", "mi", "mis", "nuestra", "nuestro", "nuestros", "meu", "minha", "meus", "minhas", "nossa", "nosso", "o", "a", "os", "as", "the"]);

const BUDGET_WORDS: Record<string, "budget" | "luxury"> = {};
["cheap", "budget", "affordable", "economico", "economica", "barato", "barata", "low-cost", "lowcost"].forEach((w) => (BUDGET_WORDS[w] = "budget"));
["luxury", "luxurious", "lusso", "lujo", "luxo", "luxuoso", "luxuosa"].forEach((w) => (BUDGET_WORDS[w] = "luxury"));

/**
 * Words a sentence wraps a place in. Trimmed from the edges of a place, never
 * from inside it: "Rio de Janeiro" keeps its "de".
 */
const FILLERS = new Set([
  "a", "an", "the", "in", "to", "for", "of", "at", "and", "trip", "travel", "holiday", "holidays", "vacation", "plan",
  "visit", "visiting", "go", "going", "around", "through", "tour", "itinerary", "please", "i", "we", "want", "would", "like",
  "per", "e", "ed", "di", "da", "il", "lo", "la", "un", "una", "viaggio", "vacanza", "vacanze", "giro", "voglio", "vorrei",
  "para", "en", "y", "el", "los", "las", "viaje", "vacaciones", "quiero", "por", "de", "del",
  "em", "no", "na", "um", "uma", "o", "os", "as", "viagem", "ferias", "quero", "pelo", "pela",
  "lo", "le", "gli", "l'",
]);
/** Articles that can open a name ("Los Angeles", "La Paz"): kept when capitalised before a capitalised word. */
const ARTICLES = new Set(["the", "la", "le", "il", "lo", "los", "las", "el", "o", "os", "as", "gli"]);

interface Token {
  raw: string;
  word: string;
  sep: boolean;
  used: boolean;
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(/[^\s,;!?]+|[,;!?]/g)].map((m) => {
    const raw = m[0];
    const sep = /^[,;!?]$/.test(raw);
    return { raw, word: sep ? raw : fold(raw), sep, used: sep };
  });
}

function numberOf(word: string): number | null {
  if (/^\d{1,2}$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

const clampDays = (n: number) => Math.min(MAX_DAYS, Math.max(2, n));

function readDays(tokens: Token[]): number | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.sep) continue;
    const next = tokens[i + 1];
    const after = tokens[i + 2];
    // "5-day", "5days", "4nights"
    const glued = /^(\d{1,2})-?([a-z]+)$/.exec(t.word);
    if (glued && (DAY_WORDS.has(glued[2]) || NIGHT_WORDS.has(glued[2]))) {
      t.used = true;
      return clampDays(Number(glued[1]) + (NIGHT_WORDS.has(glued[2]) ? 1 : 0));
    }
    const n = numberOf(t.word);
    if (n !== null && next && !next.sep) {
      if (DAY_WORDS.has(next.word) || NIGHT_WORDS.has(next.word)) {
        t.used = next.used = true;
        return clampDays(n + (NIGHT_WORDS.has(next.word) ? 1 : 0));
      }
      if (WEEK_WORDS.has(next.word) || WEEKS_WORDS.has(next.word)) {
        t.used = next.used = true;
        return clampDays(n * 7);
      }
    }
    // "weekend", "long weekend", "fine settimana", "fin de semana", "fim de semana"
    if (t.word === "weekend") {
      t.used = true;
      const long = i > 0 && tokens[i - 1].word === "long";
      if (long) tokens[i - 1].used = true;
      return long ? 4 : 3;
    }
    if ((t.word === "fine" && next?.word === "settimana") || ((t.word === "fin" || t.word === "fim") && next?.word === "de" && WEEK_WORDS.has(after?.word ?? ""))) {
      t.used = next.used = true;
      if (after && t.word !== "fine") after.used = true;
      return 3;
    }
    if (WEEK_WORDS.has(t.word)) {
      t.used = true;
      return 7;
    }
  }
  return null;
}

function readMonth(tokens: Token[]): number | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.sep || t.used) continue;
    const month = MONTHS[t.word];
    if (month === undefined) continue;
    if (AMBIGUOUS_MONTHS.has(t.word) && !MONTH_LEAD.has(tokens[i - 1]?.word ?? "")) continue;
    // Rio de Janeiro, not "Rio, in January".
    if (t.word === "janeiro" && tokens[i - 1]?.word === "de") continue;
    t.used = true;
    for (let j = i - 1; j >= 0 && !tokens[j].sep && !tokens[j].used && MONTH_LEAD.has(tokens[j].word); j--) tokens[j].used = true;
    return month;
  }
  return null;
}

function readPeople(tokens: Token[], vibes: Set<TripVibe>): "solo" | "group" | null {
  let intent: "solo" | "group" | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.sep || t.used) continue;
    if (SOLO_WORDS.has(t.word) || (t.word === "by" && tokens[i + 1]?.word === "myself")) {
      t.used = true;
      if (t.word === "by") tokens[i + 1].used = true;
      intent = "solo";
      continue;
    }
    if (!WITH_WORDS.has(t.word)) continue;
    let j = i + 1;
    while (tokens[j] && POSSESSIVES.has(tokens[j].word)) j++;
    const who = tokens[j];
    if (!who || who.sep) continue;
    if (PARTNER_WORDS.has(who.word)) vibes.add("romantic");
    else if (GROUP_WORDS.has(who.word)) intent = "group";
    else continue;
    for (let k = i; k <= j; k++) tokens[k].used = true;
  }
  return intent;
}

const capitalised = (t: Token | undefined) => !!t && /^\p{Lu}/u.test(t.raw);

/** A run of words with the fillers around it trimmed; "" when nothing else is left. */
function trimToPlace(run: Token[]): string {
  let from = 0;
  let to = run.length;
  const opensName = (i: number) => ARTICLES.has(run[i].word) && capitalised(run[i]) && i + 1 < to && capitalised(run[i + 1]);
  while (from < to && FILLERS.has(run[from].word) && !opensName(from)) from++;
  while (to > from && FILLERS.has(run[to - 1].word)) to--;
  return run
    .slice(from, to)
    .map((t) => t.raw.replace(/\.+$/, ""))
    .join(" ");
}

/** The trip a sentence describes, as far as it says. */
export function readTripSentence(text: string): TripSentence {
  const tokens = tokenize(text.trim());
  const days = readDays(tokens);
  const month = readMonth(tokens);
  const vibes = new Set<TripVibe>();
  let intent = readPeople(tokens, vibes);

  let budget: TripSentence["budget"] = null;
  for (const t of tokens) {
    if (t.used || t.sep) continue;
    const v = VIBE_WORDS[t.word];
    if (v) {
      vibes.add(v);
      t.used = true;
      continue;
    }
    const b = BUDGET_WORDS[t.word];
    if (b) {
      budget = b;
      t.used = true;
      continue;
    }
    if (PARTNER_WORDS.has(t.word)) {
      vibes.add("romantic");
      t.used = true;
    } else if (GROUP_WORDS.has(t.word)) {
      intent ??= "group";
      t.used = true;
    }
  }

  // What is left between the words read above is the place, or places.
  const runs: Token[][] = [[]];
  for (const t of tokens) {
    if (t.used) runs.push([]);
    else runs[runs.length - 1].push(t);
  }
  const places = runs.map(trimToPlace).filter((p) => p.length > 0);

  return {
    destination: places.join(" & "),
    days,
    month,
    vibes: [...vibes].slice(0, 3),
    intent,
    budget,
  };
}

/**
 * Whether a destination-search hit is the place the sentence named, case,
 * accents and a longer official name aside ("new york" ~ "New York City").
 */
export function matchesPlace(typed: string, found: { mainText: string }): boolean {
  const a = fold(typed.trim());
  const b = fold(found.mainText.trim());
  return a.length > 0 && (a === b || b.startsWith(`${a} `) || a.startsWith(`${b} `));
}

/** A sentence, not a place name: it says how long or when, and where. */
export function isTripSentence(s: TripSentence): boolean {
  return s.destination.length >= 2 && (s.days !== null || s.month !== null);
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Pencilled-in dates for a sentence: the 15th of the month it names (its next
 * occurrence at least a week away), or three weeks out like "flexible dates",
 * for as many days as it says, five otherwise.
 */
export function pencilledDates(s: Pick<TripSentence, "days" | "month">, today: string): { start: string; end: string } {
  const length = s.days ?? 5;
  let start = addDays(today, 21);
  if (s.month !== null) {
    const earliest = addDays(today, 7);
    const year = Number(today.slice(0, 4));
    const fifteenth = (y: number) => `${y}-${String(s.month).padStart(2, "0")}-15`;
    const thisMonth = Number(today.slice(5, 7)) === s.month;
    start = fifteenth(year) >= earliest ? fifteenth(year) : thisMonth ? earliest : fifteenth(year + 1);
  }
  return { start, end: addDays(start, length - 1) };
}
