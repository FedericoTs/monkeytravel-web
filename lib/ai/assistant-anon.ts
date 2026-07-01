/**
 * Anonymous trip assistant — Q&A + day-scoped EDITS for the pre-save result view.
 *
 * Supersedes lib/ai/concierge-anon.ts (read-only). Same unauth, no-DB model, but
 * this one can also PROPOSE an edit: when the traveller asks to change the plan
 * ("make day 2 cheaper", "more food on day 3"), the model returns a revised
 * version of the SINGLE day the request targets. The client previews it and
 * applies it to the in-memory itinerary on confirm — nothing is persisted.
 *
 * Day-scoped (not whole-trip) revision keeps the blast radius small and the
 * schema contained; the defensive normalizer guarantees every revised activity
 * has the fields the result view needs, so a partial model response never breaks
 * the render. Mirrors lib/ai/decide.ts's Gemini call pattern.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logCacheMetrics } from "@/lib/gemini";
import { getModelForPurpose } from "@/lib/ai/model-router";
import type { Activity, ItineraryDay } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

const LOCALE_LANGUAGE: Record<string, string> = {
  en: "English",
  it: "Italian",
  es: "Spanish",
  pt: "Portuguese",
};

const VALID_TIME_SLOTS = new Set(["morning", "afternoon", "evening"]);
const VALID_TIERS = new Set(["free", "budget", "moderate", "expensive"]);

export interface AssistAnonInput {
  message: string;
  destination: string;
  tripTitle: string;
  days: ItineraryDay[];
  startDate?: string;
  endDate?: string;
  locale?: string;
}

export interface DayEdit {
  /** 1-based day number this edit replaces. */
  day_number: number;
  /** One-line, human-readable summary of what changed. */
  summary: string;
  /** Normalized full activities for the revised day. */
  activities: Activity[];
  /** Optional revised day theme. */
  theme?: string;
}

export interface AssistAnonResult {
  reply: string;
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
      return `Day ${d.day_number}${label ? ` — ${label}` : ""}: ${acts}`;
    })
    .join("\n");
}

function buildPrompt(input: AssistAnonInput): string {
  const language = LOCALE_LANGUAGE[input.locale ?? "en"] ?? "English";
  const cur = tripCurrency(input.days);
  const dateLine =
    input.startDate && input.endDate ? `Dates: ${input.startDate} to ${input.endDate}\n` : "";
  return `You are MonkeyTravel's sharp, friendly travel assistant, helping a traveller with the trip they just generated. You can answer questions AND revise the plan.

Trip: ${input.tripTitle}
Destination: ${input.destination}
${dateLine}Currency: ${cur}
Itinerary:
${buildContext(input.days)}

Traveller's message: "${input.message}"

Decide:
- If it's a QUESTION or general advice → answer it. Set "edit" to null.
- If it's a request to CHANGE the plan → identify the SINGLE day it targets and return a revised version of THAT day only. Change as little as needed to honour the request; keep the good parts. Do NOT touch other days.

Return STRICT JSON (no markdown) in this EXACT shape:
{
  "reply": "Short chat reply in ${language}. For an edit, a one-line summary of what you changed.",
  "edit": null OR {
    "day_number": <the day you revised, matching an existing day 1-${input.days.length}>,
    "summary": "One concise sentence, in ${language}, describing the change.",
    "theme": "short day theme in ${language}",
    "activities": [
      {
        "time_slot": "morning" | "afternoon" | "evening",
        "start_time": "HH:MM",
        "duration_minutes": <integer>,
        "name": "Place or activity name (real, in the destination)",
        "type": "attraction" | "restaurant" | "activity" | "cafe" | "bar" | "museum" | "nature" | "shopping" | "nightlife",
        "description": "1 short sentence in ${language}",
        "location": "neighbourhood or area",
        "estimated_cost": { "amount": <number in ${cur}>, "currency": "${cur}", "tier": "free" | "budget" | "moderate" | "expensive" },
        "booking_required": false
      }
    ]
  }
}

Rules:
1. JSON only. "edit" is null for questions.
2. For an edit: 3-5 activities for the day, real places in ${input.destination}, costs realistic in ${cur}. Keep "description" to a few words.
3. "reply" is warm and concise (1-2 sentences). Never mention JSON.
4. Only real, safe, legal travel. If the request is impossible or off-topic, set edit=null and explain kindly in "reply".`;
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
 * Answer or propose a day-scoped edit. Throws on missing key / empty output —
 * the route maps those to a 500. Input validation is the route's job.
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
      // A day of 3-5 full activity objects + the reply can run long; give it
      // headroom so the JSON isn't truncated mid-object (which would 500 on parse).
      maxOutputTokens: 4096,
    },
  });

  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
  });
  logCacheMetrics("ai.assistant-anon", response.response.usageMetadata);

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.response.text());
  } catch {
    throw new Error("assistant-anon: model returned non-JSON output");
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const reply = str(obj.reply, "").trim();

  let edit: DayEdit | null = null;
  const rawEdit = obj.edit;
  if (rawEdit && typeof rawEdit === "object") {
    const e = rawEdit as Record<string, unknown>;
    const dayNumber = Math.round(num(e.day_number, 0));
    const exists = input.days.some((d) => d.day_number === dayNumber);
    const rawActs = Array.isArray(e.activities) ? e.activities : [];
    const activities = rawActs
      .map((r, i) => normalizeActivity(r, i, cur))
      .filter((x): x is Activity => x !== null);
    // Only surface an edit if it targets a real day and yields renderable activities.
    if (exists && activities.length > 0) {
      edit = {
        day_number: dayNumber,
        summary: str(e.summary, reply || "Updated your day"),
        activities,
        theme: typeof e.theme === "string" ? e.theme : undefined,
      };
    }
  }

  const finalReply =
    reply || (edit ? edit.summary : "Here to help — ask me anything about your trip.");

  return {
    reply: finalReply,
    edit,
    meta: { model: modelId, costUsd: 0.0006, generationTimeMs: Date.now() - startedAt },
  };
}
