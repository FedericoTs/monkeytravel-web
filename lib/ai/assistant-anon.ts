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

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logCacheMetrics } from "@/lib/gemini";
import { getModelForPurpose } from "@/lib/ai/model-router";
import { geminiCostUsd } from "@/lib/ai/gemini-cost";
import { lockedActivityNames } from "@/lib/ai/anchors-core";
import {
  applyToSaveNote,
  claimsItineraryChange,
  lengthUnchangedNote,
  lockedDayReply,
  uncoveredDaysNote,
  wizardFallbackReply,
  wizardNothingChangedReply,
} from "@/lib/ai/assistant/honesty";
import { daysMentioned } from "@/lib/ai/assistant/day-target";
import type { Activity, ItineraryDay } from "@/types";

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
/** Days one reply may rewrite; more would not fit the output budget. */
const MAX_DAYS_PER_REPLY = 6;

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
  meta: { model: string; costUsd: number; generationTimeMs: number };
}

function tripCurrency(days: ItineraryDay[]): string {
  for (const d of days) {
    const a = Array.isArray(d.activities) ? d.activities : [];
    for (const act of a) {
      const c = act?.estimated_cost?.currency;
      if (typeof c === "string" && c) return c;
    }
  }
  return "USD";
}

function buildContext(days: ItineraryDay[]): string {
  return days
    .slice(0, 20)
    .map((d) => {
      const acts = Array.isArray(d.activities)
        ? d.activities
            .map((a) => {
              const cost = a?.estimated_cost?.amount;
              const costStr = typeof cost === "number" && cost > 0 ? ` (~${cost})` : "";
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
  return `\nConversation so far (oldest first):\n${lines.join("\n")}\n`;
}

function buildPrompt(input: AssistAnonInput): string {
  const language = LOCALE_LANGUAGE[input.locale ?? "en"] ?? "English";
  const cur = tripCurrency(input.days);
  const dayCount = input.days.length;
  const dateLine =
    input.startDate && input.endDate ? `Dates: ${input.startDate} to ${input.endDate} (${dayCount} days)\n` : "";
  const multiCity = input.days.some((d) => d.city);
  return `You are MonkeyTravel's sharp, friendly travel assistant, helping a traveller with the trip they just generated. You can answer questions AND revise the plan.

Trip: ${input.tripTitle}
Destination: ${input.destination}
${dateLine}Currency: ${cur}
Itinerary:
${buildContext(input.days)}
${buildHistory(input.history)}
Traveller's new message: "${input.message}"

Decide:
- A QUESTION or general advice: answer it, and return "edits": [].
- A request to CHANGE the plan: return every day that changes, each rewritten in full, in "edits". Keep the good parts of each day and leave days that don't need to change alone.
  - Moving or swapping activities between days changes BOTH days: return both.
  - Adding or removing days, or changing how many nights a city gets: set "trip_length" to the new total number of days (1-${MAX_TRIP_DAYS}) and return every day whose content changes, including each NEW day in full. Days beyond "trip_length" are removed.${multiCity ? `
  - This is a multi-city trip: give each edited day its "city".` : ""}
  - Hotels: use only hotel names the traveller gives you or that already appear in the itinerary; never pick one for them. If they mention hotels you can't see ("the hotels I added"), ask for the names and return "edits": []. When they name where they're staying for certain nights, add a short "Check in at <place>" activity in the evening of the first of those days. The plan doesn't track hotel prices; say so if they ask for them.
  - At most ${MAX_DAYS_PER_REPLY} days per reply. If more need to change, do the first ${MAX_DAYS_PER_REPLY} and say which days are left.
- If you can't do what they ask, say so plainly and return "edits": [].

Return STRICT JSON (no markdown) in this EXACT shape:
{
  "reply": "Short chat reply in ${language}.",
  "trip_length": null OR <new total number of days, only when adding or removing days>,
  "edits": [
    {
      "day_number": <1-${MAX_TRIP_DAYS}>,${multiCity ? `
      "city": "the city this day is in",` : ""}
      "summary": "One concise sentence, in ${language}, describing the change to this day.",
      "theme": "short day theme in ${language}",
      "activities": [
        {
          "time_slot": "morning" | "afternoon" | "evening",
          "start_time": "HH:MM",
          "duration_minutes": <integer>,
          "name": "Place or activity name (real, in the destination)",
          "type": "attraction" | "restaurant" | "activity" | "cafe" | "bar" | "museum" | "nature" | "shopping" | "nightlife" | "transport",
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
2. Each edited day: 3-5 activities, real places, costs realistic in ${cur}. Keep "description" to a few words.
3. "reply" is warm and concise (1-2 sentences) and describes exactly the edits you return. Never say you changed a day that is not in "edits". Nothing changes until the traveller taps Apply, so ${READY_WORDING[input.locale ?? "en"] ?? READY_WORDING.en} Never mention JSON.
4. Only real, safe, legal travel. If the request is impossible or off-topic, return "edits": [] and explain kindly in "reply".
5. USER OVERRIDE: if the user asks for a place outside ${input.destination} (e.g. a day-trip across a border), you may note the travel-time tradeoff ONCE in "reply" — but if they insist, comply and build the edit exactly as they asked. Never refuse the same request twice.`;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
    start_time: /^\d{1,2}:\d{2}$/.test(String(a.start_time))
      ? String(a.start_time)
      : slot === "morning"
        ? "09:00"
        : slot === "afternoon"
          ? "13:00"
          : "19:00",
    duration_minutes: Math.max(15, Math.round(num(a.duration_minutes, 90))),
    name,
    type: str(a.type, "activity"),
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
  cur: string
): { edits: DayEdit[]; tripLength?: number; lockedDays: { dayNumber: number; names: string[] }[]; lengthRefused: boolean } {
  const current = days.length;
  const byDay = new Map<number, DayEdit>();
  for (const r of raw.edits) {
    if (!r || typeof r !== "object") continue;
    const e = r as Record<string, unknown>;
    const dayNumber = Math.round(num(e.day_number, 0));
    if (dayNumber < 1 || dayNumber > MAX_TRIP_DAYS) continue;
    const activities = (Array.isArray(e.activities) ? e.activities : [])
      .map((x, i) => normalizeActivity(x, i, cur))
      .filter((x): x is Activity => x !== null);
    if (activities.length === 0) continue;
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
  if (wanted !== current && wanted >= 1 && wanted <= MAX_TRIP_DAYS) {
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

/**
 * Answer or propose edits. Throws on missing key / empty output — the route
 * maps those to a 500. Input validation is the route's job.
 */
export async function assistTrip(input: AssistAnonInput): Promise<AssistAnonResult> {
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error("GOOGLE_AI_API_KEY not configured");
  }
  const startedAt = Date.now();
  const cur = tripCurrency(input.days);
  const modelId = getModelForPurpose("concierge");

  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: 0.5,
      responseMimeType: "application/json",
      // Several full days of 3-5 activity objects, plus the reply. 4096 fit
      // one day; "add one more day" failed twice as non-JSON (2026-09-15),
      // the truncation this budget prevents.
      maxOutputTokens: 8192,
      // Thinking OFF. The "concierge" purpose resolves to gemini-2.5-flash,
      // which thinks by default, and thinking tokens count against the cap
      // above — the headroom was being spent thinking. api_request_logs, 7
      // days to 2026-09-23: 67 calls, 4 HTTP 500 "non-JSON output" (each after
      // ~40 s, i.e. both attempts), 12 of 67 over 15 s, p95 37.9 s — against
      // the signed-in concierge's p95 5.0 s with 0 errors. Same fix as the
      // trip-generation paths (lib/gemini.ts).
      ...({ thinkingConfig: { thinkingBudget: 0 } } as Record<string, unknown>),
    },
  });

  // One retry on non-JSON output: flash-tier models occasionally emit prose or
  // truncated JSON despite responseMimeType. Re-asking breaks the repro loop
  // cheaply and keeps the assistant from 500ing into the generic "Couldn't do
  // that" toast that session replays show users hammering (replay 019f24bf).
  let parsed: unknown | undefined;
  let costUsd = 0;
  for (let attempt = 0; attempt < 2 && parsed === undefined; attempt++) {
    const response = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
    });
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
      if (attempt === 1) {
        throw new Error("assistant-anon: model returned non-JSON output");
      }
    }
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const reply = str(obj.reply, "").trim();

  // "edits" (current shape) or "edit" (the single-day shape, still accepted).
  const rawEdits = Array.isArray(obj.edits) ? obj.edits : obj.edit && typeof obj.edit === "object" ? [obj.edit] : [];
  const { edits, tripLength, lockedDays, lengthRefused } = validateEdits(
    input.days,
    { edits: rawEdits, tripLength: obj.trip_length },
    cur
  );

  const finalReply = composeReply({ reply, edits, tripLength, lockedDays, lengthRefused, locale: input.locale, currentDays: input.days.length });

  return {
    reply: finalReply,
    edits,
    tripLength,
    edit: edits.length === 1 && tripLength === undefined ? edits[0] : null,
    meta: { model: modelId, costUsd, generationTimeMs: Date.now() - startedAt },
  };
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
}): string {
  const prepared = p.edits.length > 0 || p.tripLength !== undefined;

  // A day withheld for a fixed plan: the model's "I've updated Day 5" would be
  // worse than the bug. Say what happened.
  if (p.lockedDays.length > 0 && !prepared) {
    const d = p.lockedDays[0];
    return lockedDayReply(p.locale, d.dayNumber, d.names);
  }
  if (!prepared) {
    // Nothing prepared, so nothing may be claimed (lib/ai/assistant/honesty).
    if (p.lengthRefused || claimsItineraryChange(p.reply)) return wizardNothingChangedReply(p.locale);
    return p.reply || wizardFallbackReply(p.locale, false);
  }

  let text = p.reply || p.edits.map((e) => e.summary).filter(Boolean).join(" ") || wizardFallbackReply(p.locale, true);
  // The reply names days the edit doesn't include (a "swap" with one side
  // missing): say so rather than let the Apply card look like the whole of it.
  const covered = p.edits.map((e) => e.day_number);
  const removed =
    p.tripLength !== undefined && p.tripLength < p.currentDays
      ? Array.from({ length: p.currentDays - p.tripLength }, (_, i) => p.tripLength! + 1 + i)
      : [];
  const uncovered = daysMentioned(text).filter((n) => !covered.includes(n) && !removed.includes(n));
  if (uncovered.length > 0 && covered.length > 0) text = `${text} ${uncoveredDaysNote(p.locale, covered, uncovered)}`;
  if (p.lengthRefused) text = `${text} ${lengthUnchangedNote(p.locale, p.currentDays)}`;
  // Told to present an unapplied edit as ready, the model still writes "Ho
  // aggiunto…" at times (measured 2026-09-26, Italian): keep the reply true.
  if (claimsItineraryChange(p.reply)) text = `${text} ${applyToSaveNote(p.locale)}`;
  return text;
}
