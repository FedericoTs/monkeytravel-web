/**
 * Free-form edits on a saved trip, through the wizard's edit engine.
 *
 * The trip page's assistant read requests with keyword patterns
 * (detectActionIntent in app/api/ai/assistant/route.ts): "replace X with Y",
 * "add X to day N" and a few more produced a change, anything else none.
 * "Adding Wigwam to Day 3", "nightclubs on the 2nd, 4th and 6th night" or two
 * changes in one message got a reply promising the change, and no change.
 * The wizard's engine (lib/ai/assistant-anon.ts) has the model write the
 * revised days itself, from the whole plan and the conversation; here those
 * days are merged into the saved trip and proposed as one multi-day change.
 */

import { assistTrip, type AssistTurn, type DayEdit } from "@/lib/ai/assistant-anon";
import { lengthUnchangedNote } from "@/lib/ai/assistant/honesty";
import { applyAssistantEdits } from "@/lib/trips/day-edit-merge";
import type { Activity, ItineraryDay } from "@/types";

// Words that ask for a change. English as whole words ("add" must not match
// "address"); Spanish, Italian and Portuguese as stems, for their endings.
const CHANGE_WORDS_EN = [
  "add(?:s|ed|ing)?", "includ(?:e|es|ed|ing)", "put(?:s|ting)?", "insert(?:s|ed|ing)?", "fit(?:s|ting)?",
  "squeez(?:e|es|ed|ing)", "remov(?:e|es|ed|ing)", "delet(?:e|es|ed|ing)", "drop(?:s|ped|ping)?",
  "skip(?:s|ped|ping)?", "cut(?:s|ting)?", "take (?:out|off)", "get rid", "replac(?:e|es|ed|ing)",
  "swap(?:s|ped|ping)?", "switch(?:es|ed|ing)?", "chang(?:e|es|ed|ing)", "mov(?:e|es|ed|ing)",
  "shift(?:s|ed|ing)?", "reschedul(?:e|es|ed|ing)", "rearrang(?:e|es|ed|ing)", "reorder(?:s|ed|ing)?",
  "reorgani[sz](?:e|es|ed|ing)", "optimi[sz](?:e|es|ed|ing)", "shorten(?:s|ed|ing)?", "extend(?:s|ed|ing)?",
  "lengthen(?:s|ed|ing)?", "mak(?:e|es|ing)", "updat(?:e|es|ed|ing)", "edit(?:s|ed|ing)?",
  "modif(?:y|ies|ied|ying)", "adjust(?:s|ed|ing)?", "instead", "prefer(?:s|red|ring)?", "rather", "less", "more",
  "fewer", "lighter", "busier", "packed", "earlier", "later", "free up",
];
const CHANGE_STEMS = [
  // es
  "añad", "agreg", "inclu", "quit", "elimin", "borr", "cambi", "muev", "mover", "reemplaz", "sustitu",
  "intercambi", "reorganiz", "acort", "alarg", "prefier", "prefiero", "quiero", "quisiera", "más", "menos",
  "en vez", "en lugar",
  // it
  "aggiung", "inseri", "includ", "metti", "togli", "rimuov", "cancell", "spost", "sostitu", "scambi",
  "riorganizz", "accorci", "allung", "preferi", "vorrei", "voglio", "più", "meno", "invece",
  // pt
  "adicion", "acrescent", "coloc", "tire", "tirar", "remov", "exclu", "apag", "troc", "mude", "mudar", "mova",
  "substitu", "encurt", "prolong", "prefir", "quero", "queria", "mais", "em vez",
];
const CHANGE_WORDS = new RegExp(
  [
    ...CHANGE_WORDS_EN.map((w) => `(?:^|[^\\p{L}])${w}(?![\\p{L}])`),
    ...CHANGE_STEMS.map((w) => `(?:^|[^\\p{L}])${w}`),
  ].join("|"),
  "iu",
);

const QUESTION_START =
  /^\s*[¿¡]?\s*(?:what|what's|when|where|which|who|whose|why|how|is|are|was|were|do|does|did|should|would|could|can|will|qu[eé]|cu[aá]l(?:es)?|cu[aá]nto|cu[aá]ndo|d[oó]nde|c[oó]mo|por qu[eé]|che|cosa|qual[ei]?|quant[oiae]|quando|dove|come|perch[eé]|quais|onde|quanto|por que)(?=[\s?,.!]|$)/iu;

/**
 * A question with no change in it ("what time does the Louvre open?") goes to
 * the chat as before. Everything else goes to the edit engine, which also
 * answers when nothing needs to change.
 */
export function isPlainQuestion(message: string): boolean {
  const text = message.trim();
  if (!text || CHANGE_WORDS.test(text)) return false;
  return text.endsWith("?") || QUESTION_START.test(text);
}

/** The saved conversation, as the engine reads it (oldest first, last six turns). */
export function conversationTurns(messages: { role?: unknown; content?: unknown }[] | null | undefined): AssistTurn[] {
  return (messages ?? [])
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "",
    )
    .slice(-6)
    .map((m) => ({ role: m.role, text: m.content }));
}

/**
 * The revised days, merged into the saved trip. applyAssistantEdits pairs each
 * returned activity with a saved one of the same name (keeping its id); a
 * paired activity then keeps everything the trip holds for it (description,
 * photos, booking, place details) and takes only its new time. The engine
 * writes descriptions short, and a saved trip must not lose detail to an edit.
 * Day number, date and city stay those of the saved day.
 */
export function mergeTripEdits(days: ItineraryDay[], edits: DayEdit[]): ItineraryDay[] {
  const merged = applyAssistantEdits(
    days,
    edits.map(({ day_number, activities, theme }) => ({ day_number, activities, theme })),
  );
  const saved = new Map<string, Activity>();
  for (const d of days) for (const a of d.activities ?? []) if (a?.id) saved.set(a.id, a);
  const edited = new Set(edits.map((e) => e.day_number));
  return merged
    .filter((d) => edited.has(d.day_number))
    .map((d) => {
      const base = days.find((o) => o.day_number === d.day_number) ?? d;
      return {
        ...base,
        theme: d.theme ?? base.theme,
        activities: d.activities.map((a) => {
          const kept = a.id ? saved.get(a.id) : undefined;
          return kept
            ? { ...kept, time_slot: a.time_slot, start_time: a.start_time, duration_minutes: a.duration_minutes }
            : a;
        }),
      };
    });
}

const DAY_LABEL: Record<string, string> = { en: "Day", es: "Día", it: "Giorno", pt: "Dia" };
const LEAVES_OUT: Record<string, string> = { en: "Leaves out", es: "Deja fuera", it: "Lascia fuori", pt: "Deixa de fora" };

/** Saved activities of the revised days that none of them holds any more. */
function leftOut(days: ItineraryDay[], revisedDays: ItineraryDay[]): string[] {
  const kept = new Set(revisedDays.flatMap((d) => d.activities.map((a) => a.id)));
  const revised = new Set(revisedDays.map((d) => d.day_number));
  return days
    .filter((d) => revised.has(d.day_number))
    .flatMap((d) => d.activities ?? [])
    .filter((a) => a?.id && !kept.has(a.id))
    .map((a) => a.name);
}

export interface TripEditProposal {
  reply: string;
  /** The revised days, merged into the saved trip; empty when nothing changes. */
  revisedDays: ItineraryDay[];
  /** What changes, day by day, for the preview card. */
  summary: string;
  meta: { model: string; costUsd: number; generationTimeMs: number };
}

/**
 * Ask the engine. Null when the reply is not for this page: a request to see
 * prices in another currency is answered by the wizard switching currency,
 * which the trip page does not do.
 */
export async function proposeTripEdits(input: {
  message: string;
  destination: string;
  tripTitle: string;
  days: ItineraryDay[];
  startDate?: string;
  endDate?: string;
  locale: string;
  history: AssistTurn[];
}): Promise<TripEditProposal | null> {
  const result = await assistTrip({ ...input, autoApply: true });
  if (result.currency) return null;

  // Days are added with "add a day" and dates move on the trip page, so this
  // path keeps the trip's length. Edits to its existing days still stand.
  const current = input.days.length;
  const edits = result.edits.filter((e) => e.day_number <= current);
  const reply =
    result.tripLength !== undefined ? `${result.reply} ${lengthUnchangedNote(input.locale, current)}` : result.reply;

  const label = DAY_LABEL[input.locale] ?? DAY_LABEL.en;
  const revisedDays = edits.length > 0 ? mergeTripEdits(input.days, edits) : [];
  // The model can swap out a saved activity while its reply calls the change
  // an addition, so the card names what the change takes out before Apply.
  const removed = leftOut(input.days, revisedDays);
  const summary = edits
    .filter((e) => e.summary.trim())
    .map((e) => `${label} ${e.day_number}: ${e.summary.trim()}`)
    .join(" ");
  return {
    reply,
    revisedDays,
    summary: removed.length
      ? `${summary} ${LEAVES_OUT[input.locale] ?? LEAVES_OUT.en}: ${removed.join(", ")}.`.trim()
      : summary,
    meta: result.meta,
  };
}
