/**
 * A day the closing-day check moves to another date (lib/ai/closing-days.ts)
 * keeps its words, and some were written for the date it left: "Vatican City
 * and Christmas Day" moved to the 24th, "Start your Sunday at the market"
 * moved to a Monday. When a moved day's title, theme or notes, or one of its
 * stops' descriptions or tips, names a weekday or a holiday of the dates the
 * check asks about, one short question re-words just those texts for the new
 * date. Days without such words cost nothing, and a failed question leaves the
 * words as they were.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";

export type WordStop = { name?: string; type?: string; description?: string; tips?: string[] };
export type WordDay = {
  day_number?: number;
  date?: string;
  title?: string;
  theme?: string;
  notes?: string;
  activities?: WordStop[];
};
/** A day the reorder moved: where it is in the plan now, and the date its words were written for. */
export type Move = { slot: number; from?: string };

/**
 * Weekdays, and the holidays from Christmas to Epiphany, the first of May and
 * Thanksgiving, in the plan's four languages, with the short and local names
 * plans use for them ("NYE", Hogmanay, Japan's shōgatsu and ōmisoka). A word
 * starting with a letter outside A-Z is matched from its first plain letter
 * ("misoka" in "Ōmisoka"): a word boundary is only seen before plain letters.
 */
const DATED_WORDS = new RegExp(
  [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "luned", "marted", "mercoled", "gioved", "venerd", "sabato", "domenica",
    "lunes", "martes", "mi[eé]rcoles", "jueves", "viernes", "s[aá]bado", "domingo",
    "segunda-feira", "ter[cç]a-feira", "quarta-feira", "quinta-feira", "sexta-feira",
    "christmas", "xmas", "boxing day", "new year", "epiphany", "thanksgiving", "may day", "labou?r day",
    "nye\\b", "hogmanay", "st\\.? stephen", "hatsum", "o?sh[oō]gatsu", "omisoka", "misoka",
    "natal", "vigilia", "santo stefano", "capodanno", "san silvestro", "epifan", "befana", "primo maggio",
    "festa dei lavoratori", "ringraziamento", "navid", "nochebuena", "nochevieja", "a[nñ]o nuevo", "reyes",
    "acci[oó]n de gracias", "d[ií]a del trabajo", "v[eé]spera", "consoada", "r[eé]veillon", "ano novo",
    "dia de reis", "a[cç][aã]o de gra[cç]as", "dia do trabalh",
  ]
    .map((word) => `\\b${word}`)
    .join("|"),
  "i"
);

/** Whether a text names a weekday or one of those holidays. */
export function hasDatedWords(text: unknown): text is string {
  return typeof text === "string" && DATED_WORDS.test(text);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dateLabel = (date?: string) =>
  date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${date}` : "";

/** At most this many texts in one question. */
const MAX_TEXTS = 30;
const TIMEOUT_MS = 4000;

type Spot = { slot: number; field: "title" | "theme" | "notes" | "description" | "tip"; stop?: number; tip?: number; text: string };

/** A moved day's texts that name its old date's weekday or holiday. A stop's name is a place's name: never re-worded. */
function spotsOf(day: WordDay, slot: number): Spot[] {
  const spots: Spot[] = [];
  for (const field of ["title", "theme", "notes"] as const) {
    const text = day[field];
    if (hasDatedWords(text)) spots.push({ slot, field, text });
  }
  (day.activities ?? []).forEach((stop, i) => {
    if (hasDatedWords(stop.description)) spots.push({ slot, field: "description", stop: i, text: stop.description });
    (Array.isArray(stop.tips) ? stop.tips : []).forEach((tip, j) => {
      if (hasDatedWords(tip)) spots.push({ slot, field: "tip", stop: i, tip: j, text: tip });
    });
  });
  return spots;
}

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    texts: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: { n: { type: SchemaType.INTEGER }, text: { type: SchemaType.STRING } },
        required: ["n", "text"],
      },
    },
  },
  required: ["texts"],
};

/**
 * The days with the moved days' dated texts re-worded for their new date, and what that cost. The same array when
 * nothing is re-worded: no moved day has such a text, there is no key, or the question fails or takes too long.
 */
export async function rewordMovedDays<T extends WordDay>(
  days: T[],
  moves: Move[],
  destination: string
): Promise<{ days: T[]; costUsd: number; reworded: number }> {
  const unchanged = { days, costUsd: 0, reworded: 0 };
  const from = new Map(
    moves
      .filter((move) => dateLabel(move.from) !== "" && days[move.slot] !== undefined)
      .map((move): [number, string | undefined] => [move.slot, move.from])
  );
  const spots = [...from.keys()].flatMap((slot) => spotsOf(days[slot], slot)).slice(0, MAX_TEXTS);
  if (spots.length === 0 || !process.env.GOOGLE_AI_API_KEY) return unchanged;

  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 2048,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  const question = [
    `Days of a trip to ${destination} were moved to other dates, and these texts were written for the date their day had before. Rewrite each one for the date its day has now: change only the words that tie it to the old date (that weekday, or a holiday falling on it), and keep everything else as it is, in the same language. A text that already fits the new date comes back exactly as it was.`,
    ...spots.map(
      (spot, i) =>
        `${i + 1}. (was ${dateLabel(from.get(spot.slot))}, now ${dateLabel(days[spot.slot].date)}) ${spot.text.replace(/\s+/g, " ")}`
    ),
  ].join("\n");

  try {
    const result = await withTimeout(model.generateContent(question), TIMEOUT_MS, "Moved day words");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    const costUsd = geminiCostUsd(modelName, usage);
    const answer = JSON.parse(result.response.text()) as { texts?: Array<{ n?: unknown; text?: unknown }> };
    const rewritten = new Map<number, string>();
    for (const entry of answer.texts ?? []) {
      const at = typeof entry.n === "number" ? entry.n - 1 : -1;
      const spot = spots[at];
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      // An empty answer, the same words, or far more of them is no re-wording.
      if (!spot || !text || text === spot.text || text.length > spot.text.length * 2 + 60) continue;
      rewritten.set(at, text);
    }
    if (rewritten.size === 0) return { ...unchanged, costUsd };
    const next = days.map((day, slot) => {
      const mine = [...rewritten].filter(([at]) => spots[at].slot === slot);
      if (mine.length === 0) return day;
      const copy: WordDay = {
        ...day,
        activities: day.activities?.map((stop) => ({ ...stop, ...(Array.isArray(stop.tips) ? { tips: [...stop.tips] } : {}) })),
      };
      for (const [at, text] of mine) {
        const spot = spots[at];
        const stop = spot.stop === undefined ? undefined : copy.activities?.[spot.stop];
        if (spot.field === "description" && stop) stop.description = text;
        else if (spot.field === "tip" && stop?.tips && spot.tip !== undefined) stop.tips[spot.tip] = text;
        else if (spot.field === "title" || spot.field === "theme" || spot.field === "notes") copy[spot.field] = text;
      }
      return copy as T;
    });
    console.info(`[moved-day-words] re-worded ${rewritten.size} of ${spots.length} text(s) for "${destination}"`);
    return { days: next, costUsd, reworded: rewritten.size };
  } catch (err) {
    console.warn("[moved-day-words] not re-worded:", err instanceof Error ? err.message : String(err));
    return unchanged;
  }
}
