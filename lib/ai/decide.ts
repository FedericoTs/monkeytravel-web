/**
 * Decision-first front door — "propose options" step.
 * Plan: docs/DECISION_FRONT_DOOR_PLAN.md
 *
 * Turns a free-text trip prompt ("a relaxed food trip in Asia, ~$1500, late
 * July, 5-ish days") into 2-3 concrete destination/trip-shape PROPOSALS — the
 * DECISION the traveller makes before any detailed itinerary. Once they pick
 * one, the client maps it to TripCreationParams and the EXISTING generator +
 * result page run unchanged.
 *
 * Cheap + fast like the packing-list tool: gemini-2.5-flash-lite, tiny output,
 * pure model reasoning — NO Google Places at this step (a destination is just a
 * string until the user picks + generates), so it preserves the June-2026 cost
 * fix (Places only on save). Clones the packing-list.ts structured-output
 * pattern (prompt-embedded JSON shape + responseMimeType:"application/json" +
 * defensive parse), which is proven in prod.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logCacheMetrics } from "@/lib/gemini";
import { getModelForPurpose } from "@/lib/ai/model-router";
import type { TripVibe } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// The valid vibe set the itinerary generator + validateTripParams accept
// (keep in lockstep with TripVibe, types/index.ts). Proposals whose vibes fall
// outside this set are filtered/backfilled so the picked option can never 500
// downstream at /api/ai/generate.
const VALID_VIBES: readonly TripVibe[] = [
  "adventure",
  "cultural",
  "foodie",
  "wellness",
  "romantic",
  "urban",
  "nature",
  "offbeat",
  "wonderland",
  "movie-magic",
  "fairytale",
  "retro",
];
const VALID_VIBE_SET = new Set<string>(VALID_VIBES);
const VALID_TIERS = new Set(["budget", "balanced", "premium"]);
const VALID_PACES = new Set(["relaxed", "moderate", "active"]);

export interface DecideInput {
  /** Free-text: what trip they're dreaming of. */
  prompt: string;
  /** Optional loose hints — the model infers whatever is missing. */
  month?: string;
  nights?: number;
  budgetHint?: "budget" | "balanced" | "premium";
  travelStyle?: "classic" | "backpacker";
  origin?: string;
}

export interface TripProposal {
  id: string;
  /** Real place as "City, Country" — re-validated at /api/ai/generate on pick. */
  destination: string;
  trip_shape: {
    days: number;
    pace: "relaxed" | "moderate" | "active";
    theme: string;
  };
  why: string;
  tradeoff: string;
  budget_fit: {
    tier: "budget" | "balanced" | "premium";
    rough_total_usd: number;
    note: string;
  };
  /** Suggested — the traveller confirms/edits before generate. */
  suggested_dates: { start: string; end: string };
  vibes: TripVibe[];
  interests: string[];
}

export interface DecideResult {
  proposals: TripProposal[];
  meta: { model: string; costUsd: number; generationTimeMs: number };
}

function buildDecidePrompt(input: DecideInput, today: string): string {
  const hints: string[] = [];
  if (input.month) hints.push(`Timing hint: ${input.month}`);
  if (input.nights) hints.push(`Length hint: about ${input.nights} nights`);
  if (input.budgetHint) hints.push(`Budget hint: ${input.budgetHint}`);
  if (input.travelStyle) hints.push(`Travel style: ${input.travelStyle}`);
  if (input.origin) hints.push(`Travelling from: ${input.origin}`);
  const hintBlock = hints.length
    ? `\nKnown constraints:\n- ${hints.join("\n- ")}\n`
    : "";

  return `You are a sharp, opinionated travel advisor. A traveller tells you, in their own words, about a trip they're dreaming of. Your job is to help them DECIDE — propose 2-3 concrete destinations (each with a trip shape) that fit what they said, with the reasoning and the honest tradeoff. This is the decision BEFORE any detailed itinerary.

Today's date is ${today}. Treat that as "now" — all suggested dates MUST be in the future, using the correct upcoming year.

Traveller's words: "${input.prompt}"
${hintBlock}
Return STRICT JSON (no markdown, no prose) in this EXACT shape:
{
  "proposals": [
    {
      "id": "p1",
      "destination": "City, Country",
      "trip_shape": { "days": 5, "pace": "relaxed" | "moderate" | "active", "theme": "short evocative theme" },
      "why": "One sentence: why THIS fits what they asked for.",
      "tradeoff": "One honest downside or thing to know.",
      "budget_fit": { "tier": "budget" | "balanced" | "premium", "rough_total_usd": 1400, "note": "brief cost reasoning incl. rough travel from origin if given" },
      "suggested_dates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
      "vibes": ["cultural", "foodie"],
      "interests": ["seafood", "old town"]
    }
  ]
}

Rules:
1. JSON only. 2-3 proposals. Each MUST be genuinely DIFFERENT from the others (not three versions of the same place) — vary the region, the budget, or the character of the trip so the traveller has a REAL choice.
2. Be specific and, where it fits, non-obvious — a great advisor surprises. But every proposal must actually honour the constraints (budget, timing, style, who's travelling).
3. "destination" must be a REAL place written as "City, Country" (or "Region, Country"). Never invent a place.
4. "vibes" MUST be 1-3 values chosen ONLY from this exact set: ${VALID_VIBES.join(", ")}. Never invent a vibe.
5. "trip_shape.days": an integer 1-14 fitting the length hint (sensible default if none).
6. "suggested_dates": concrete YYYY-MM-DD start/end that (a) honours the timing hint if given, (b) is AFTER today's date (${today}) in the correct upcoming year — NEVER a past date, (c) spans trip_shape.days. These are suggestions the traveller will confirm.
7. "budget_fit.tier" is ONLY one of: budget, balanced, premium. "rough_total_usd" is a realistic all-in per-person estimate.
8. Keep "why" and "tradeoff" to ONE warm, concrete sentence each — no fluff.
9. Only propose real, safe, legal travel. If the prompt isn't about travel, still return 2-3 broadly-appealing trip ideas.`;
}

/**
 * Generate 2-3 trip proposals from a free-text prompt. Throws on missing key,
 * malformed model output, or zero usable proposals — the route maps those to a
 * 500. Input validation (length/injection) is the route's job.
 */
export async function generateProposals(input: DecideInput): Promise<DecideResult> {
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error("GOOGLE_AI_API_KEY not configured");
  }
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, server "now"
  const modelId = getModelForPurpose("decide");

  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      // Some variety across the 2-3 options (unlike the deterministic
      // packing-list). Still bounded output — can't blow the token budget.
      temperature: 0.7,
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
    },
  });

  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: buildDecidePrompt(input, today) }] }],
  });
  logCacheMetrics("ai.decide", response.response.usageMetadata);

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.response.text());
  } catch {
    throw new Error("decide: model returned non-JSON output");
  }
  const rawProposals = (parsed as { proposals?: unknown })?.proposals;
  if (!Array.isArray(rawProposals)) {
    throw new Error("decide: model output missing proposals array");
  }

  // Defensive normalize + validate. Drop unusable proposals; clamp/backfill the
  // rest so a picked option always satisfies the downstream validateTripParams.
  const proposals: TripProposal[] = [];
  for (let i = 0; i < rawProposals.length && proposals.length < 3; i++) {
    const p = (rawProposals[i] ?? {}) as Record<string, unknown>;
    const destination = typeof p.destination === "string" ? p.destination.trim() : "";
    if (!destination) continue; // no place → unusable, skip

    const shape = (p.trip_shape ?? {}) as Record<string, unknown>;
    const days = clampInt(Number(shape.days), 1, 14, input.nights ?? 4);
    const pace = VALID_PACES.has(String(shape.pace))
      ? (shape.pace as "relaxed" | "moderate" | "active")
      : "moderate";

    let vibes = Array.isArray(p.vibes)
      ? ((p.vibes as unknown[]).map(String).filter((v) => VALID_VIBE_SET.has(v)) as TripVibe[])
      : [];
    vibes = vibes.slice(0, 3);
    if (vibes.length === 0) vibes = ["cultural"]; // backfill → downstream validate passes

    const budget = (p.budget_fit ?? {}) as Record<string, unknown>;
    const tier = VALID_TIERS.has(String(budget.tier))
      ? (budget.tier as "budget" | "balanced" | "premium")
      : input.budgetHint ?? "balanced";
    const dates = (p.suggested_dates ?? {}) as Record<string, unknown>;

    proposals.push({
      id: typeof p.id === "string" && p.id ? p.id : `p${proposals.length + 1}`,
      destination,
      trip_shape: { days, pace, theme: str(shape.theme, "") },
      why: str(p.why, ""),
      tradeoff: str(p.tradeoff, ""),
      budget_fit: {
        tier,
        rough_total_usd: Number.isFinite(Number(budget.rough_total_usd))
          ? Math.round(Number(budget.rough_total_usd))
          : 0,
        note: str(budget.note, ""),
      },
      // Defensive: the model still occasionally returns a stale/past year
      // despite the prompt. Never surface a past date to the client date-picker
      // — clamp to a sensible upcoming range so the seeded DateRangePicker is
      // always valid (the traveller confirms it before generate anyway).
      suggested_dates: normalizeSuggestedDates(dates.start, dates.end, days, today),
      vibes,
      interests: Array.isArray(p.interests)
        ? (p.interests as unknown[]).map(String).slice(0, 8)
        : [],
    });
  }

  if (proposals.length === 0) {
    throw new Error("decide: no usable proposals after validation");
  }

  return {
    proposals,
    meta: { model: modelId, costUsd: 0.0005, generationTimeMs: Date.now() - startedAt },
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function clampInt(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function isValidIsoDate(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  );
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/**
 * Guarantee a valid, future-dated start/end range spanning `days`. ISO
 * YYYY-MM-DD compares lexicographically == chronologically, so string >= works.
 * Falls back to ~a month out if the model's dates are missing or in the past.
 */
function normalizeSuggestedDates(
  rawStart: unknown,
  rawEnd: unknown,
  days: number,
  today: string
): { start: string; end: string } {
  const start =
    isValidIsoDate(rawStart) && rawStart >= today ? rawStart : addDaysIso(today, 30);
  const end =
    isValidIsoDate(rawEnd) && rawEnd > start ? rawEnd : addDaysIso(start, days);
  return { start, end };
}
