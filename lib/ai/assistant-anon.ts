/**
 * The wizard's trip assistant — Q&A + EDITS for the result view (signed out or
 * in; the trip may or may not be saved yet).
 *
 * Supersedes lib/ai/concierge-anon.ts (read-only). Same unauth, no-DB model, but
 * this one can also PROPOSE edits: when the traveller asks to change the plan
 * the model returns the revised days. The client previews them and applies
 * them to the in-memory itinerary on confirm; the wizard's auto-save persists
 * a saved trip from there.
 *
 * One reply may change several days and the trip's length (2026-09-26). It
 * used to be one day only, so a swap between two days came back as one day
 * with a reply claiming both, and "add one more day" or "Quito 2 nights,
 * Baños 1" could not be done at all: people regenerated the whole trip and
 * lost their edits. The defensive normalizer still guarantees every revised
 * activity has the fields the result view needs, so a partial model response
 * never breaks the render.
 */

import { GoogleGenerativeAI, type GenerateContentResult, type GenerationConfig } from "@/lib/ai/genai-compat";
import { logCacheMetrics } from "@/lib/gemini";
import { getModelForPurpose, getSiblingModel, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd } from "@/lib/ai/gemini-cost";
import { lockedActivityNames } from "@/lib/ai/anchors-core";
import {
  announcedButMissing,
  announcesProposal,
  asksToRemove,
  claimsLongerTrip,
  daysLeftNote,
  hasFigures,
  isConfirmation,
  offersChange,
  replyLanguage,
  takesOutNote,
  notAppliedLead,
  claimsItineraryChange,
  lengthUnchangedNote,
  lockedDayReply,
  missingAnswerReply,
  planCostsReply,
  uncoveredDaysNote,
  wizardFallbackReply,
  wizardNothingChangedReply,
  withoutDanglingLead,
} from "@/lib/ai/assistant/honesty";
import { planCosts, planCurrency, type DisplayCurrency, type PlanCosts } from "@/lib/ai/assistant/plan-costs";
import { dayMentioned, daysMentioned } from "@/lib/ai/assistant/day-target";
import { currencyRequested, currencySwitchedNote, withoutCurrencyTalk } from "@/lib/ai/assistant/currency-request";
import type { Activity, ItineraryDay } from "@/types";
import { ACTIVITY_TYPES, normalizeActivityType } from "@/lib/trip/activity-type";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

const LOCALE_LANGUAGE: Record<string, string> = {
  en: "English",
  it: "Italian",
  es: "Spanish",
  pt: "Portuguese",
};

// How a reply presents an edit that is still waiting for Apply, per language:
// the model kept writing "I've added" / "Ho aggiunto" for an unapplied edit.
const READY_WORDING: Record<string, string> = {
  en: `present the edits as ready, not done: "Here's a new Day 6 with…", "Ready to swap Days 1 and 2:…". Never write "I've added", "I've swapped", "I've moved" or "Done".`,
  it: `presenta le modifiche come pronte, non fatte: "Ecco un nuovo giorno 6 con…", "Pronto a scambiare i giorni 1 e 2:…". Non scrivere mai "Ho aggiunto", "Ho spostato", "Ho scambiato" o "Fatto".`,
  es: `presenta los cambios como listos, no hechos: "Aquí tienes un nuevo día 6 con…", "Listo para cambiar los días 1 y 2:…". Nunca escribas "He añadido", "He movido", "He cambiado" ni "Hecho".`,
  pt: `apresente as mudanças como prontas, não feitas: "Aqui está um novo dia 6 com…", "Pronto para trocar os dias 1 e 2:…". Nunca escreva "Adicionei", "Movi", "Troquei" nem "Feito".`,
};

const VALID_TIME_SLOTS = new Set(["morning", "afternoon", "evening"]);
const VALID_TIERS = new Set(["free", "budget", "moderate", "expensive"]);

/** Same cap as the wizard and the signed-in assistant (lib/ai/assistant/structural). */
export const MAX_TRIP_DAYS = 14;
/** The wizard's cap for a trip across several cities. */
export const MAX_TRIP_DAYS_MULTI = 21;

/**
 * The longest this trip may be: its own cap, or its current length when it is
 * already past it. Before this, a three-city trip longer than the single-city
 * cap lost every edit to its last days, and a request about them was refused.
 */
export function maxTripDays(days: ItineraryDay[]): number {
  const cap = days.some((d) => d.city) ? MAX_TRIP_DAYS_MULTI : MAX_TRIP_DAYS;
  return Math.max(cap, days.length);
}
/** Days one reply may rewrite; more would not fit the output budget. */
const MAX_DAYS_PER_REPLY = 6;
/** A change about more days asks for the rest at once, if it can start by now… */
const MORE_DAYS_START_MS = 32_000;
/** …and stops waiting for them here, inside the route's 60 s. */
const MORE_DAYS_DEADLINE_MS = 52_000;
/** Tokens the model may think for before answering (see assistTrip). */
const THINKING_BUDGET = 1024;
/** Later than this, a reply that needs correcting stands: the route has 60 s. */
const CORRECTION_DEADLINE_MS = 25_000;

export interface AssistTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistAnonInput {
  message: string;
  destination: string;
  tripTitle: string;
  days: ItineraryDay[];
  startDate?: string;
  endDate?: string;
  locale?: string;
  /**
   * The conversation so far, oldest first. Without it "sure", "yes" or "No I
   * mean…" had nothing to refer to (2026-09-16 and 09-26 sessions).
   */
  history?: AssistTurn[];
  /** The page applies the edits as soon as they arrive (with Undo). */
  autoApply?: boolean;
  /**
   * The reply names activities a change takes out that weren't asked to go.
   * The wizard's card shows only the new day; the trip page's card lists them.
   */
  explainRemovals?: boolean;
  /** The currency the page shows prices in, when it isn't the plan's own. */
  display?: DisplayCurrency;
}

export interface DayEdit {
  /** 1-based day number this edit replaces (or adds, with a longer trip). */
  day_number: number;
  /** One-line, human-readable summary of what changed. */
  summary: string;
  /** Normalized full activities for the revised day. */
  activities: Activity[];
  /** Optional revised day theme. */
  theme?: string;
  /** Multi-city trips: the city this day now takes place in. */
  city?: string;
}

export interface AssistAnonResult {
  reply: string;
  /** Every day this reply changes (or adds), in day order. Empty for answers. */
  edits: DayEdit[];
  /** The trip's new total number of days, when the reply adds or removes days. */
  tripLength?: number;
  /** Legacy single-day field for clients from before multi-day edits. */
  edit: DayEdit | null;
  /** The currency the planner asked prices in; the page switches its preference to it. */
  currency?: string;
  meta: { model: string; costUsd: number; generationTimeMs: number };
}

/**
 * The plan's activity costs, as the traveller sees them, so a question about
 * the total gets real figures rather than the model's own arithmetic.
 */
function costLines(costs: PlanCosts | null): string {
  if (!costs) return "";
  const view = costs.shown ?? costs;
  const perDay = view.perDay.map((d) => `Day ${d.day} ~${d.amount}`).join(", ");
  const own = costs.shown ? ` (${costs.total} ${costs.currency} in the plan's own amounts)` : "";
  // Travel between a multi-city plan's cities is a priced card of the plan.
  return `Activity costs, as the traveller sees them in ${view.currency}: ${perDay}. Total ~${view.total} ${view.currency}${own}. These count only what the plan lists: hotels, and any travel it doesn't list, cost extra.\n`;
}

// Each price names its currency, and the one the traveller sees when that
// differs: a bare "(~250)" next to a euro total was quoted back as euros.
function buildContext(days: ItineraryDay[], display?: DisplayCurrency): string {
  const cur = planCurrency(days);
  const shown = display && display.currency !== cur && display.rate > 0 ? display : undefined;
  return days
    .slice(0, MAX_TRIP_DAYS_MULTI)
    .map((d) => {
      const acts = Array.isArray(d.activities)
        ? d.activities
            .map((a) => {
              const cost = a?.estimated_cost?.amount;
              const seen = typeof cost === "number" && shown ? ` ≈ ${Math.round(cost * shown.rate)} ${shown.currency}` : "";
              const costStr = typeof cost === "number" && cost > 0 ? ` (~${cost} ${cur}${seen})` : "";
              return a && typeof a.name === "string" ? `${a.name}${costStr}` : "";
            })
            .filter(Boolean)
            .join(", ")
        : "";
      const label = d.theme || d.title || "";
      const city = d.city ? ` [${d.city}]` : "";
      return `Day ${d.day_number}${city}${label ? ` — ${label}` : ""}: ${acts}`;
    })
    .join("\n");
}

function buildHistory(history: AssistTurn[] | undefined): string {
  const turns = (history ?? []).slice(-6);
  if (turns.length === 0) return "";
  const lines = turns.map((t) => `${t.role === "user" ? "Traveller" : "You"}: ${t.text.slice(0, 600)}`);
  // Undo and Skip leave the conversation as it was: "already done" was the
  // answer to a request repeated after an Undo.
  return `\nConversation so far (oldest first):\n${lines.join("\n")}\nThe itinerary above is the plan as it is now. A change from earlier in the conversation that isn't in it was only offered, skipped or undone: if they ask for it, make it.\n`;
}

export function buildPrompt(input: AssistAnonInput): string {
  const language = LOCALE_LANGUAGE[input.locale ?? "en"] ?? "English";
  const cur = planCurrency(input.days);
  const costs = planCosts(input.days, input.display);
  const shownCur = costs?.shown?.currency ?? input.display?.currency ?? cur;
  const dayCount = input.days.length;
  const maxDays = maxTripDays(input.days);
  const dateLine =
    input.startDate && input.endDate ? `Dates: ${input.startDate} to ${input.endDate} (${dayCount} days)\n` : "";
  const multiCity = input.days.some((d) => d.city);
  return `You are MonkeyTravel's sharp, friendly travel assistant, helping a traveller with the trip they just generated. You can answer questions AND revise the plan.

Trip: ${input.tripTitle}
Destination: ${input.destination}
${dateLine}Currency: ${cur}
Itinerary:
${buildContext(input.days, input.display)}
${costLines(costs)}${buildHistory(input.history)}
Traveller's new message: "${input.message}"

First work out what the traveller actually wants, the way a good travel agent would:
- A statement about their trip asks you to fit the plan to it: "we have a car", "my hotel is near X", "we land at 11:00 on day 1", "my wife is vegetarian", "I'm travelling with my 70-year-old mother". Change every day it affects.
- A misspelled or partial name means the most likely real place near the destination ("aya sofya" is Hagia Sophia).
- Ambiguous wording takes the meaning a travel agent would assume ("activities under 18" means suitable for under-18s). Ask one short question only when the readings would lead to very different plans.
- A short "yes", "ok", "do it" or "continue" answers your previous message: make exactly the change you offered there, or the one it said some days still needed, nothing more. With nothing offered before it, ask what they'd like to change.
- A message can ask for several things: do every one. Before answering, check each part against your edits; if a part can't be done, say which and why in "reply".
- The traveller can undo or skip any change, so when a request is clear enough, make it instead of asking for permission or for details, and mention any trade-off in "reply".

Then decide:
- A QUESTION or general advice: answer it, and return "edits": [].
  - Asked for a summary or overview: give one short line per day.
  - Asked where to stay or for hotels: suggest 2-3 concrete areas or well-known hotels near where this plan spends its days, each with a short reason, as ideas to check.
  - Asked for a PDF, a file or a printout: you can't make files; point them to the page's own options (save the trip, share its link, or print the page from the browser).
- A request to CHANGE the plan: return every day that changes, each rewritten in full, in "edits". Change only what was asked: keep every other activity exactly as it is, under its exact name (never translate or rename activities), and leave days that don't need to change alone.
  - A change about the whole trip ("every day", "all the dinners", "cheaper", "less packed", a car, a diet) applies to every day it concerns, not just one.
  - A day the traveller names is the day to change. If that clashes with the day's plan, still make the change there and note the trade-off in "reply".
  - Something already in the plan: say on which day. If they want it on another day or at another time, move it there instead of adding it twice.
  - Moving or swapping activities between days changes BOTH days: return both.
  - Something to add with no day named ("add a cooking class", "suggest a restaurant to add"): pick the day with the most room where it fits, add it there without removing anything, and name that day in "reply". Don't ask which day.
  - Adding never removes an activity unless the day can't fit both. When a change leaves an activity already in the plan without room (what they add, a late arrival, a closure, a long drive), move that activity to another day with room rather than dropping it, and say where it went.
  - Asked for alternatives or other things to do: put your best picks into the plan as edits, so they can be applied, say in "reply" what they replace, and name one or two other good options they can ask for instead. If they want to choose first ("I'll let you know"), list the options in "reply" and change nothing yet.
  - Keep the number of days unless the traveller asks for more or fewer. A new place or day trip goes into the existing days, replacing the lightest day or part of one, and "reply" says what it replaces.
  - Adding or removing days when asked, or changing how many nights a city gets: set "trip_length" to the new total number of days (1-${maxDays}) and return every day whose content changes, including each NEW day in full. New days come first, before any existing day you also change. Days beyond "trip_length" are removed.${multiCity ? `
  - This is a multi-city trip: give each edited day its "city".` : ""}
  - Hotels in the plan: use only hotel names the traveller gives you or that already appear in the itinerary. If they mention hotels you can't see ("the hotels I added"), ask for the names and return "edits": []. When they name where they're staying for certain nights, add a short "Check in at <place>" activity in the evening of the first of those days. The plan doesn't track hotel prices; give a typical range if they ask.
  - At most ${MAX_DAYS_PER_REPLY} days in "edits". When the change concerns more days, return the first ${MAX_DAYS_PER_REPLY} and list every other day it concerns in "more_days": those are made right after, the same way, so "reply" describes the whole change as done for every day it concerns, never as "the first ${MAX_DAYS_PER_REPLY} days".
- Use only real places, where they really are. If something they ask for doesn't exist nearby, say so and offer the closest real alternative. Give prices and travel times you're unsure of as rough ranges.
- If you can't do what they ask, say so plainly and return "edits": [].

Return STRICT JSON (no markdown) in this EXACT shape:
{
  "reply": "Short chat reply in the language of the traveller's new message (${language} if unclear).",
  "trip_length": null OR <new total number of days, only when adding or removing days>,
  "more_days": [] OR [the other day numbers this change concerns, past the ${MAX_DAYS_PER_REPLY} in "edits"],
  "edits": [
    {
      "day_number": <1-${maxDays}>,${multiCity ? `
      "city": "the city this day is in",` : ""}
      "summary": "One concise sentence, in ${language}, describing the change to this day.",
      "theme": "short day theme in ${language}",
      "activities": [
        {
          "time_slot": "morning" | "afternoon" | "evening",
          "start_time": "HH:MM",
          "duration_minutes": <integer>,
          "name": "Place or activity name (real, in the destination)",
          "type": ${ACTIVITY_TYPES.map((t) => `"${t}"`).join(" | ")},
          "description": "1 short sentence in ${language}",
          "location": "neighbourhood or area",
          "estimated_cost": { "amount": <number in ${cur}>, "currency": "${cur}", "tier": "free" | "budget" | "moderate" | "expensive" },
          "booking_required": false
        }
      ]
    }
  ]
}

Rules:
1. JSON only. "edits" is [] for questions.
2. Each edited day: 3-5 activities (fewer when the traveller asks to remove things, one more when you add to a full day), real places, costs realistic in ${cur}. Never fill a gap with a placeholder like "free time for lunch". A day they want free has no activities: "activities": []. Keep "description" to a few words.
3. For a change, "reply" is warm and brief and says what changed, one short line per day when several days change, describing exactly the edits you return. Never say you changed a day that is not in "edits". Nothing changes until the traveller taps Apply, so ${READY_WORDING[input.locale ?? "en"] ?? READY_WORDING.en} Never mention JSON.
4. For a question, the whole answer goes in "reply". When it needs figures (a total, a budget, what a day costs), give the numbers right there, in ${shownCur}: start from the activity costs above and add clearly labelled estimates for what the plan leaves out, such as hotels and flights. A few short lines are fine, as plain text: each on its own line starting with "- ", no * or **. Never announce an answer ("here is the total…") without giving it. A practical answer ends with what to do about it (what to pack, what to book ahead).
5. Only real, safe, legal travel. If the request is impossible or off-topic, return "edits": [] and explain kindly in "reply".
6. USER OVERRIDE: if the user asks for a place outside ${input.destination} (e.g. a day-trip across a border), you may note the travel-time tradeoff ONCE in "reply" — but if they insist, comply and build the edit exactly as they asked. Never refuse the same request twice.
7. The app shows prices in the traveller's chosen currency by itself. A request to see prices in another currency needs no edits: never rewrite days to change the currency, and don't say which currency the plan is shown in. Prices are per person: asked for a group's costs ("for 2 people"), give that many people's totals in "reply" and change nothing.
8. Times are "HH:MM" and the plan shows them in 24-hour form. A request for AM/PM times needs no edits: say the plan shows 24-hour times.`;
}

/**
 * The panel shows replies as plain text, so Markdown would print as asterisks:
 * "**Costo attività:**", "*   Voli…". Bold is dropped and bullets become "- ".
 */
export function plainText(reply: string): string {
  return reply.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[ \t]*[*•][ \t]+/gm, "- ");
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** A start time as "HH:MM" (read from "9:30 AM" or "21h30" too), or null. */
export function clockTime(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  const hm = (h: number, m: number) => (h < 24 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null);
  if (/^\d{1,2}:\d{2}$/.test(s)) return hm(Number(s.split(":")[0]), Number(s.split(":")[1])) && s;
  const ampm = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\.?$/.exec(s);
  if (ampm && Number(ampm[1]) >= 1 && Number(ampm[1]) <= 12) {
    return hm((Number(ampm[1]) % 12) + (ampm[3] === "p" ? 12 : 0), Number(ampm[2] ?? 0));
  }
  const h = /^(\d{1,2})h(\d{2})?$/.exec(s);
  return h ? hm(Number(h[1]), Number(h[2] ?? 0)) : null;
}

function normalizeActivity(raw: unknown, idx: number, cur: string): Activity | null {
  const a = (raw ?? {}) as Record<string, unknown>;
  const name = typeof a.name === "string" ? a.name.trim() : "";
  if (!name) return null; // no name → unrenderable, drop
  const slot = VALID_TIME_SLOTS.has(String(a.time_slot))
    ? String(a.time_slot)
    : idx === 0
      ? "morning"
      : idx === 1
        ? "afternoon"
        : "evening";
  const costRaw = (a.estimated_cost ?? {}) as Record<string, unknown>;
  const tier = VALID_TIERS.has(String(costRaw.tier)) ? String(costRaw.tier) : "moderate";
  return {
    time_slot: slot,
    // A real slot-based fallback (never "") so downstream iCal export can't
    // produce a corrupt DTSTART when the model omits start_time.
    start_time: clockTime(a.start_time) ?? (slot === "morning" ? "09:00" : slot === "afternoon" ? "13:00" : "19:00"),
    duration_minutes: Math.max(15, Math.round(num(a.duration_minutes, 90))),
    name,
    type: normalizeActivityType(a.type, name),
    description: str(a.description, ""),
    location: str(a.location, ""),
    estimated_cost: {
      amount: Math.max(0, Math.round(num(costRaw.amount, 0))),
      currency: str(costRaw.currency, cur),
      tier,
    },
    tips: Array.isArray(a.tips) ? (a.tips as unknown[]).map(String).slice(0, 4) : [],
    booking_required: a.booking_required === true,
  } as Activity;
}

/**
 * Validate the model's edits against the trip. Pure, so the rules are
 * unit-tested (lib/ai/assistant-anon-edits.vitest.ts).
 *
 * - A new trip length counts only if every added day comes back in full; a
 *   shorter one may not drop a day holding a fixed plan (F1 anchor).
 * - A day holding a fixed plan is never rewritten: an edit REPLACES the whole
 *   day, and anchors are the traveller's to remove.
 * - Edits for days outside the trip are dropped; one per day (the last wins).
 */
export function validateEdits(
  days: ItineraryDay[],
  raw: { edits: unknown[]; tripLength: unknown },
  cur: string,
  /** The traveller asked for a free day, so a day emptied is the change. */
  allowEmpty = false
): { edits: DayEdit[]; tripLength?: number; lockedDays: { dayNumber: number; names: string[] }[]; lengthRefused: boolean } {
  const current = days.length;
  const max = maxTripDays(days);
  const byDay = new Map<number, DayEdit>();
  for (const r of raw.edits) {
    if (!r || typeof r !== "object") continue;
    const e = r as Record<string, unknown>;
    const dayNumber = Math.round(num(e.day_number, 0));
    if (dayNumber < 1 || dayNumber > max) continue;
    const activities = (Array.isArray(e.activities) ? e.activities : [])
      .map((x, i) => normalizeActivity(x, i, cur))
      .filter((x): x is Activity => x !== null);
    const emptied = allowEmpty && Array.isArray(e.activities) && e.activities.length === 0;
    if (activities.length === 0 && !emptied) continue;
    byDay.set(dayNumber, {
      day_number: dayNumber,
      summary: str(e.summary, ""),
      activities,
      theme: typeof e.theme === "string" && e.theme.trim() ? e.theme : undefined,
      city: typeof e.city === "string" && e.city.trim() ? e.city.trim() : undefined,
    });
  }

  let length = current;
  let lengthRefused = false;
  const wanted = Math.round(num(raw.tripLength, current));
  if (wanted !== current && wanted >= 1 && wanted <= max) {
    const added = Array.from({ length: Math.max(0, wanted - current) }, (_, i) => current + 1 + i);
    const dropped = days.filter((d) => d.day_number > wanted);
    const lockedDrop = dropped.some((d) => lockedActivityNames(d).length > 0);
    if (added.every((n) => byDay.has(n)) && !lockedDrop) length = wanted;
    else lengthRefused = true;
  }

  const lockedDays: { dayNumber: number; names: string[] }[] = [];
  const edits: DayEdit[] = [];
  for (const edit of [...byDay.values()].sort((a, b) => a.day_number - b.day_number)) {
    if (edit.day_number > length) continue;
    const names = lockedActivityNames(days.find((d) => d.day_number === edit.day_number));
    if (names.length > 0) {
      lockedDays.push({ dayNumber: edit.day_number, names });
      continue;
    }
    edits.push(edit);
  }
  return { edits, tripLength: length !== current ? length : undefined, lockedDays, lengthRefused };
}

// Words too common in activity names to tell two places apart.
const GENERIC_WORDS = new Set([
  "explore", "explorar", "esplora", "explorando", "exploration", "visit", "visita", "visitar", "lunch", "dinner",
  "breakfast", "brunch", "almuerzo", "comida", "cena", "desayuno", "pranzo", "colazione", "almoco", "jantar", "tour",
  "walk", "stroll", "paseo", "passeggiata", "passeio", "the", "and", "del", "della", "delle", "with", "con", "com",
  "around", "near", "free", "time",
]);
const nameTokens = (name: string): string[] => [
  ...new Set(
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 3 && !GENERIC_WORDS.has(t)),
  ),
];

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
function sameWord(a: string, b: string): boolean {
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
 */
export function keepSavedActivities(
  days: ItineraryDay[],
  edits: DayEdit[],
  talk: { reply?: string; message?: string } = {},
): DayEdit[] {
  const saved = days.flatMap((d) =>
    (Array.isArray(d.activities) ? d.activities : [])
      .filter((a) => typeof a?.name === "string" && a.name.trim())
      .map((a) => ({ a, tokens: nameTokens(a.name) })),
  );
  const said = nameTokens(`${talk.reply ?? ""} ${talk.message ?? ""}`);
  const asked = nameTokens(talk.message ?? "").filter((t) => t.length >= 5);
  const used = new Set<Activity>();
  return edits.map((e) => ({
    ...e,
    activities: e.activities.map((n) => {
      const mine = nameTokens(n.name);
      let best: { a: Activity; score: number } | null = null;
      for (const s of saved) {
        if (used.has(s.a)) continue;
        let score = s.a.name.trim().toLowerCase() === n.name.trim().toLowerCase() ? 2 : 0;
        if (!score && mine.length && mine.every((t) => s.tokens.some((u) => sameWord(t, u)))) {
          score = s.tokens.filter((u) => mine.some((t) => sameWord(t, u))).length / s.tokens.length;
        }
        if (score >= 0.6 && (!best || score > best.score)) best = { a: s.a, score };
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

// "Add 2 more days", "one more night", "extend the trip", "un día más",
// "2 giorni in più", "mais um dia", or a length in days. The wizard's date
// change asks with "set trip_length".
const L = "\\p{L}";
const MORE_DAYS = new RegExp(
  [
    "trip_length",
    `(?<![${L}])(?:add|adding|extra|more|another|extend|extending|longer|lengthen|más|otro|otra|añad\\p{L}*|agreg\\p{L}*|extend\\p{L}*|alarg\\p{L}*|più|altr[oi]|aggiung\\p{L}*|allung\\p{L}*|estend\\p{L}*|mais|outr[oa]s?|adicion\\p{L}*|acrescent\\p{L}*|prolong\\p{L}*)(?![${L}])[^.?!\\n]{0,24}?(?<![${L}])(?:day|days|night|nights|día|días|noche|noches|giorno|giorni|notte|notti|dia|dias|noite|noites)(?![${L}])`,
    `(?<![${L}])(?:giorn[oi]|nott[ei])\\s+in\\s+più`,
    `(?<![${L}\\p{N}])\\d{1,2}\\s*(?:days|nights|días|noches|giorni|notti|dias|noites)(?![${L}])`,
  ].join("|"),
  "iu",
);

// A day trip fits inside the trip: "add a day trip", "excursión de un día".
const DAY_TRIP =
  /day[\s-]?trips?|excursi[oó]n(?:es)? de un d[ií]a|gite? di un giorno|excurs(?:ão|ões) de um dia|bate[\s-]?volta/giu;

/** Does the conversation ask for a longer trip? */
export function asksForMoreDays(text: string): boolean {
  return MORE_DAYS.test(text.replace(DAY_TRIP, " "));
}

// A day with nothing planned: "leave day 2 free", "deixe o dia 2 livre".
const FREE_DAY =
  /(?<![\p{L}])(?:free|empty|clear|day\s+off|nothing\s+planned|libres?|vac[ií][oa]s?|liber[oiae]|vuot[oiae]|livres?|vazi[oa]s?|folga)(?![\p{L}])/iu;

/** Does the message ask for a day with nothing planned? */
export function asksForFreeDay(message: string): boolean {
  return FREE_DAY.test(message);
}

// Telling, not asking, where they stay: "our hotel is Hotel Arts", "we're
// staying at…", "nuestro hotel es…", "il nostro hotel è…", "vamos ficar no…".
const STAYING_AT =
  /(?:\b(?:our|my)\s+(?:hotel|airbnb|accommodation|hostel|stay)\s+(?:is|will be)\b|\b(?:we(?:'re| are)|i(?:'m| am))\s+staying\s+(?:at|in)\b|\bwe\s+booked\s+(?:a\s+|an\s+|the\s+)?(?:hotel|airbnb|room|apartment)\b|nuestro\s+(?:hotel|alojamiento)\s+es|nos\s+(?:alojamos|quedamos)\s+en|il\s+nostro\s+(?:hotel|albergo|alloggio)\s+è|alloggiamo\s+(?:a|al|in|presso)|o\s+nosso\s+(?:hotel|alojamento)\s+é|vamos\s+ficar\s+(?:no|na|em))/iu;
const CHECK_IN = /check[\s-]?in|registro|registrazione|registrar/iu;
// "Our hotel is near the station": an area, not a place to check in at.
const NEAR = /^\s*(?:near|close|next|around|by|cerca|junto|al\s+lado|vicino|accanto|perto|ao\s+lado)\b/iu;

/** Does the message tell (not ask) the place they stay at? */
function tellsWhereTheyStay(message: string): boolean {
  const m = STAYING_AT.exec(message);
  return !!m && !message.includes("?") && !NEAR.test(message.slice(m.index + m[0].length));
}

type Outcome = ReturnType<typeof validateEdits> & { reply: string; moreDays: number[] };

/** The model's JSON, as the reply and checked edits this engine works with. */
function readOutcome(input: AssistAnonInput, obj: Record<string, unknown>, cur: string): Outcome {
  const reply = plainText(str(obj.reply, "").trim());
  // "edits" (current shape) or "edit" (the single-day shape, still accepted).
  const rawEdits = Array.isArray(obj.edits) ? obj.edits : obj.edit && typeof obj.edit === "object" ? [obj.edit] : [];
  const checked = validateEdits(input.days, { edits: rawEdits, tripLength: obj.trip_length }, cur, asksForFreeDay(input.message));
  const edits = keepSavedActivities(input.days, checked.edits, { reply, message: input.message });
  // The other days the change concerns, past what one reply holds. A day with
  // a fixed plan is never rewritten (validateEdits), so it is not one of them.
  const length = checked.tripLength ?? input.days.length;
  const done = new Set(edits.map((e) => e.day_number));
  const moreDays = [...new Set((Array.isArray(obj.more_days) ? obj.more_days : []).map((n) => Math.round(num(n, 0))))]
    .filter((n) => n >= 1 && n <= length && !done.has(n))
    .filter((n) => lockedActivityNames(input.days.find((d) => d.day_number === n)).length === 0)
    .sort((a, b) => a - b);
  return { ...checked, edits, reply, moreDays };
}

/** The days with these edits made, for the next part of a change and its costs. */
function withEdits(days: ItineraryDay[], edits: DayEdit[]): ItineraryDay[] {
  const byDay = new Map(edits.map((e) => [e.day_number, e]));
  return days.map((d) => {
    const e = byDay.get(d.day_number);
    return e ? { ...d, theme: e.theme ?? d.theme, activities: e.activities } : d;
  });
}

/** Does the edit leave its day as it was (same activities at the same times)? */
function leavesDayAsItWas(days: ItineraryDay[], e: DayEdit): boolean {
  const old = days.find((d) => d.day_number === e.day_number)?.activities ?? [];
  return old.length === e.activities.length && old.every((a, i) => a?.name === e.activities[i].name && a?.start_time === e.activities[i].start_time);
}

/** What the next part of a change is asked with. */
function continuePrompt(reply: string, done: number[], group: number[]): string {
  return `CONTINUE: you are partway through this change. Your reply was: "${reply.slice(0, 600)}". Days ${done.join(", ")} are done, and the itinerary above shows them. Now return Days ${group.join(", ")} in "edits", each in full, changed the same way, and no other day. "more_days" is [], "trip_length" is null, and "reply" is one short line.`;
}

/** The promise's value, or a rejection once `ms` have passed. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("assistant-anon: out of time")), Math.max(0, ms));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** What a reply got wrong that one more try may fix, or null. Pure; unit-tested. */
export function correctionFor(
  input: Pick<AssistAnonInput, "message" | "history" | "days">,
  o: Pick<Outcome, "reply" | "edits" | "tripLength">,
): string | null {
  const current = input.days.length;
  const prepared = o.edits.length > 0 || o.tripLength !== undefined;
  if (!prepared && announcesProposal(o.reply)) {
    return `Your "reply" hands over a change, but "edits" is empty. Put that change in "edits" now, or say plainly in "reply" that you couldn't make it.`;
  }
  const last = input.history?.at(-1);
  if (!prepared && isConfirmation(input.message) && last?.role === "assistant" && (offersChange(last.text) || announcesProposal(last.text))) {
    return `The traveller said yes to the change your last message offered. Make exactly that change now, in "edits".`;
  }
  if (!prepared && announcedButMissing(o.reply)) {
    return 'Your "reply" announced an answer without giving it. Put the whole answer in "reply" now.';
  }
  const day = dayMentioned(input.message);
  if (day && day <= current && o.edits.length > 0 && !o.edits.some((e) => e.day_number === day)) {
    return `The traveller named Day ${day}. Make the change on Day ${day}, keeping its other activities unless they can't fit. If Day ${day} really can't work, change nothing and say why in "reply", suggesting another day.`;
  }
  if (tellsWhereTheyStay(input.message) && !o.edits.some((e) => e.activities.some((a) => CHECK_IN.test(a.name)))) {
    return `The traveller told you where they are staying. Add a short "Check in at <place>" activity on the first day of that stay (evening, or after their arrival), keeping everything else.`;
  }
  const recent = [input.message, ...(input.history ?? []).slice(-2).map((t) => t.text)].join("\n");
  if (o.tripLength !== undefined && o.tripLength > current && !asksForMoreDays(recent)) {
    return `Keep the trip at ${current} days: fit the change into the existing days and say in "reply" what it replaces. Add days only when the traveller asks.`;
  }
  if (o.edits.length > 0 && o.tripLength === undefined && o.edits.every((e) => leavesDayAsItWas(input.days, e))) {
    return `Your edits left every day as it was. Make the change the traveller asked for, or say plainly in "reply" that you didn't.`;
  }
  // Asked only to add, a day lost one or two of its activities (a whole day
  // swapped for a day trip is the expected way to fit one in).
  const dropped = takenOut(input.days, o.edits);
  if (asksToAdd(input.message) && !asksToRemove(input.message) && dropped.length > 0 && dropped.length <= 2) {
    return `They asked only to add. Keep ${dropped.join(" and ")} and add the new activity alongside, moving times if needed. Take something out only if the day truly can't fit it, and then say which in "reply".`;
  }
  // A saved activity (its name is kept, see keepSavedActivities) added to a
  // day while the one day that has it is left as it was. A name on several
  // saved days ("Breakfast at the hotel") recurs on purpose.
  const key = (x?: string) => (x ?? "").trim().toLowerCase();
  const edited = new Set(o.edits.map((e) => e.day_number));
  for (const e of o.edits) {
    for (const a of e.activities) {
      const name = key(a.name);
      if (!name) continue;
      const holders = input.days.filter((d) => (d.activities ?? []).some((b) => key(b?.name) === name));
      if (holders.length === 1 && !edited.has(holders[0].day_number)) {
        const twin = holders[0].day_number;
        return `${a.name} is already on Day ${twin}. To have it on Day ${e.day_number}, move it: also return Day ${twin} without it. Otherwise leave it where it is and say so in "reply".`;
      }
    }
  }
  return null;
}

// Asking for something to be added: "add", "include", "agrega", "aggiungi"…
const ADD_ASK =
  /(?<![\p{L}])(?:add|adding|include|put|insert|fit|squeeze|agrega|agregar|añade|añadir|incluye|incluir|pon|aggiungi|aggiungere|inserisci|includi|metti|adiciona|adicionar|acrescenta|inclui|incluir|coloca)(?![\p{L}])/iu;

/** Does the traveller's message ask for something to be added? */
export function asksToAdd(message: string): boolean {
  return ADD_ASK.test(message);
}

/** 429, 500 and 503 ("high demand") are the model pool's, not the request's. */
export function isModelOverloaded(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 429 || status === 500 || status === 503;
}

/**
 * Answer or propose edits. Throws on missing key / empty output — the route
 * maps those to a 500. Input validation is the route's job.
 */
export async function assistTrip(input: AssistAnonInput): Promise<AssistAnonResult> {
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error("GOOGLE_AI_API_KEY not configured");
  }
  const startedAt = Date.now();
  const cur = planCurrency(input.days);
  let modelId = getModelForPurpose("concierge");

  const generationConfig: GenerationConfig = {
    temperature: 0.3,
    responseMimeType: "application/json",
    // Several full days of 3-5 activity objects, plus the reply. 4096 fit
    // one day; "add one more day" failed twice as non-JSON (2026-09-15),
    // the truncation this budget prevents.
    // Thinking counts against this cap, hence the budget on top of the reply.
    maxOutputTokens: 8192 + THINKING_BUDGET,
    // A small, fixed thinking budget. With none, multi-part and whole-trip
    // requests came back half done; unbounded, thinking ate the output cap
    // and the replies arrived truncated or slow.
    thinkingConfig: thinkingConfigFor(modelId, THINKING_BUDGET),
  };
  let costUsd = 0;

  // One retry on non-JSON output: flash-tier models occasionally emit prose or
  // truncated JSON despite responseMimeType. Re-asking breaks the repro loop
  // cheaply and keeps the assistant from 500ing into the generic "Couldn't do
  // that" toast that session replays show users hammering (replay 019f24bf).
  // An overloaded model gets the same single retry, on its sibling: overload
  // errors belong to one model's serving pool.
  const ask = async (prompt: string, attempts = 2): Promise<Record<string, unknown>> => {
    let model = genAI.getGenerativeModel({ model: modelId, generationConfig });
    let parsed: unknown | undefined;
    for (let attempt = 0; attempt < attempts && parsed === undefined; attempt++) {
      let response: GenerateContentResult;
      try {
        response = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
      } catch (err) {
        if (attempt === attempts - 1 || !isModelOverloaded(err)) throw err;
        console.warn(`assistant-anon: ${modelId} overloaded, retrying on its sibling`);
        modelId = getSiblingModel(modelId);
        model = genAI.getGenerativeModel({
          model: modelId,
          generationConfig: { ...generationConfig, thinkingConfig: thinkingConfigFor(modelId, THINKING_BUDGET) },
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      logCacheMetrics("ai.assistant-anon", response.response.usageMetadata, modelId);
      costUsd += geminiCostUsd(modelId, response.response.usageMetadata);
      try {
        parsed = JSON.parse(response.response.text());
      } catch {
        // MAX_TOKENS means the cap was hit (the thinking-budget failure mode);
        // STOP means the model really did answer in prose. Logged so the two
        // are told apart from the logs rather than guessed.
        console.warn(
          `assistant-anon: non-JSON output (attempt ${attempt + 1}), finishReason:`,
          response.response.candidates?.[0]?.finishReason ?? "unknown"
        );
        if (attempt === attempts - 1) {
          throw new Error("assistant-anon: model returned non-JSON output");
        }
      }
    }
    return (parsed ?? {}) as Record<string, unknown>;
  };

  // A reply that breaks a rule the model was given (another day than the one
  // named, a longer trip nobody asked for, an answer announced and not given)
  // gets one more try with the rule spelled out, while there's time for one.
  // The first reply stands when the second fails or is no better.
  const prompt = buildPrompt(input);
  let outcome = readOutcome(input, await ask(prompt), cur);
  const correction = correctionFor(input, outcome);
  if (correction && Date.now() - startedAt < CORRECTION_DEADLINE_MS) {
    try {
      const retried = readOutcome(input, await ask(`${prompt}\n\nCORRECTION: ${correction}`, 1), cur);
      if (!correctionFor(input, retried)) outcome = retried;
    } catch (err) {
      console.warn("assistant-anon: correction failed, keeping the first reply:", err instanceof Error ? err.message : err);
    }
  }
  const { reply, tripLength, lockedDays, lengthRefused } = outcome;
  let edits = outcome.edits;

  // A change about more days than one reply holds: the first reply names the
  // other days ("more_days"), they are asked for together, the same way, and
  // the days of a part that doesn't come back in time are named in the reply.
  let daysLeft = tripLength === undefined ? outcome.moreDays : [];
  if (daysLeft.length > 0 && Date.now() - startedAt < MORE_DAYS_START_MS) {
    const sofar = withEdits(input.days, edits);
    const done = edits.map((e) => e.day_number);
    const groups = Array.from({ length: Math.ceil(daysLeft.length / MAX_DAYS_PER_REPLY) }, (_, i) =>
      daysLeft.slice(i * MAX_DAYS_PER_REPLY, (i + 1) * MAX_DAYS_PER_REPLY),
    );
    const parts = await Promise.allSettled(
      groups.map((group) =>
        within(
          ask(`${buildPrompt({ ...input, days: sofar })}\n\n${continuePrompt(reply, done, group)}`, 1),
          MORE_DAYS_DEADLINE_MS - (Date.now() - startedAt),
        ),
      ),
    );
    const answered = new Set<number>();
    parts.forEach((part, i) => {
      if (part.status !== "fulfilled") return;
      const group = new Set(groups[i]);
      groups[i].forEach((n) => answered.add(n));
      const more = readOutcome(input, { ...part.value, trip_length: null }, cur).edits;
      edits = [...edits, ...more.filter((e) => group.has(e.day_number) && !leavesDayAsItWas(input.days, e))];
    });
    edits.sort((a, b) => a.day_number - b.day_number);
    daysLeft = daysLeft.filter((n) => !answered.has(n));
  }

  const currency = currencyRequested(input.message) ?? undefined;
  const finalReply = composeReply({
    reply,
    edits,
    tripLength,
    lockedDays,
    lengthRefused,
    locale: input.locale,
    currentDays: input.days.length,
    currency,
    autoApplied: input.autoApply,
    costs: planCosts(input.days, input.display),
    costsAfter: planCosts(withEdits(input.days, edits), input.display),
    daysLeft,
    askedForMoreDays: asksForMoreDays(input.message),
    takenOut: input.explainRemovals && !asksToRemove(input.message) ? takenOut(input.days, edits) : [],
  });

  return {
    reply: finalReply,
    edits,
    tripLength,
    edit: edits.length === 1 && tripLength === undefined ? edits[0] : null,
    currency,
    meta: { model: modelId, costUsd, generationTimeMs: Date.now() - startedAt },
  };
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

const DAY_WORD: Record<string, string> = { en: "Day", es: "Día", it: "Giorno", pt: "Dia" };

/** One line per changed day, from the edits' own summaries. */
function daySummaries(locale: string | undefined, edits: DayEdit[]): string {
  const word = DAY_WORD[locale ?? "en"] ?? DAY_WORD.en;
  return edits
    .filter((e) => e.summary.trim())
    .map((e) => `- ${word} ${e.day_number}: ${e.summary.trim()}`)
    .join("\n");
}

/**
 * What the traveller reads. The model's words are kept only when they match
 * what was actually prepared (pure; unit-tested).
 */
export function composeReply(p: {
  reply: string;
  edits: DayEdit[];
  tripLength?: number;
  lockedDays: { dayNumber: number; names: string[] }[];
  lengthRefused: boolean;
  locale?: string;
  currentDays: number;
  currency?: string;
  /** The page applies the edits on arrival, so "I've updated…" will be true. */
  autoApplied?: boolean;
  /** The plan's activity costs, for an announced total that never came. */
  costs?: PlanCosts | null;
  /** The same, once the change is made. */
  costsAfter?: PlanCosts | null;
  /** Days the change concerns that could not be prepared in time. */
  daysLeft?: number[];
  /** The traveller asked for a longer trip. */
  askedForMoreDays?: boolean;
  /** Activities the change takes out that the traveller didn't ask to remove. */
  takenOut?: string[];
}): string {
  const prepared = p.edits.length > 0 || p.tripLength !== undefined;
  // Notes join the reply, in its language: a Spanish message about a plan
  // made in English got a Spanish reply with an English note.
  const locale = replyLanguage(p.reply) ?? p.locale;

  // A currency request is answered by the page switching currency; the model
  // cannot change it and used to reply "already in euros" regardless.
  if (p.currency && !prepared) {
    const kept = withoutCurrencyTalk(p.reply);
    const rest = kept && !claimsItineraryChange(kept) ? `${kept} ` : "";
    return `${rest}${currencySwitchedNote(locale, p.currency)}`;
  }

  // A day withheld for a fixed plan: the model's "I've updated Day 5" would be
  // worse than the bug. Say what happened.
  if (p.lockedDays.length > 0 && !prepared) {
    const d = p.lockedDays[0];
    return lockedDayReply(locale, d.dayNumber, d.names);
  }
  if (!prepared) {
    // Nothing prepared, so nothing may be claimed or handed over
    // (lib/ai/assistant/honesty).
    if (p.lengthRefused || claimsItineraryChange(p.reply) || announcesProposal(p.reply)) {
      return wizardNothingChangedReply(locale);
    }
    // "Here is the total…" with no total: give the plan's own figures instead,
    // unless figures came before an announcement that ends the reply.
    const missing = announcedButMissing(p.reply);
    if (missing) {
      const before = withoutDanglingLead(p.reply);
      if (before !== p.reply.trim() && hasFigures(before)) return before;
      return missing === "cost" && p.costs ? planCostsReply(locale, p.costs) : missingAnswerReply(locale);
    }
    return p.reply || wizardFallbackReply(locale, false);
  }

  let text = p.reply || p.edits.map((e) => e.summary).filter(Boolean).join(" ") || wizardFallbackReply(locale, true);
  // Next to a currency switch, the model's "the plan is already in EUR" goes;
  // the prices of the change stay.
  if (p.currency) text = withoutCurrencyTalk(text, true) || text;
  // "Here's how the revised costs look:" and nothing after it: the figures,
  // from the plan as changed, or what each day now does.
  const missing = announcedButMissing(text);
  if (missing) {
    const answer = missing === "cost" && p.costsAfter ? planCostsReply(locale, p.costsAfter) : daySummaries(locale, p.edits);
    text = [withoutDanglingLead(text), answer].filter(Boolean).join("\n") || wizardFallbackReply(locale, true);
  }
  // The reply names days the edit doesn't include (a "swap" with one side
  // missing): say so rather than let the Apply card look like the whole of it.
  const covered = p.edits.map((e) => e.day_number);
  const removed =
    p.tripLength !== undefined && p.tripLength < p.currentDays
      ? Array.from({ length: p.currentDays - p.tripLength }, (_, i) => p.tripLength! + 1 + i)
      : [];
  const left = p.daysLeft ?? [];
  const uncovered = daysMentioned(text).filter((n) => !covered.includes(n) && !removed.includes(n) && !left.includes(n));
  if (uncovered.length > 0 && covered.length > 0) text = `${text} ${uncoveredDaysNote(locale, covered, uncovered)}`;
  if (left.length > 0) text = `${text} ${daysLeftNote(locale, left)}`;
  if (p.lengthRefused || (p.tripLength === undefined && p.askedForMoreDays && claimsLongerTrip(text))) {
    text = `${text} ${lengthUnchangedNote(locale, p.currentDays)}`;
  }
  // "Add a Jameson tour" quietly replaced the Guinness visit: name what goes,
  // unless the reply did ("the Gràcia activities" for "Lunch at Con Gracia").
  const said = nameTokens(text);
  const namedInReply = (name: string) => {
    const words = nameTokens(name);
    const found = words.filter((w) => said.some((s) => sameWord(w, s))).length;
    return text.toLowerCase().includes(name.toLowerCase()) || (words.length > 0 && found >= words.length / 2);
  };
  const unmentioned = (p.takenOut ?? []).filter((n) => !namedInReply(n));
  if (unmentioned.length > 0) text = `${text} ${takesOutNote(locale, unmentioned)}`;
  // Told to present an unapplied edit as ready, the model still writes "I've
  // updated…" most of the time: lead with the truth so Apply isn't skipped.
  if (!p.autoApplied && claimsItineraryChange(p.reply)) text = `${notAppliedLead(locale)} ${text}`;
  if (p.currency) text = `${text} ${currencySwitchedNote(locale, p.currency)}`;
  return text;
}
