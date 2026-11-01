/**
 * Concierge edit-proposal protocol — the pure core of P2 Stage B
 * (docs/PRODUCT_PLAN_COCREATION_2026_08.md, "the edit channel").
 *
 * The in-trip concierge streams a plain-text answer; when the user asked for
 * a change it appends ONE machine-readable proposal after a sentinel marker
 * on the final line. This module owns everything about that wire format that
 * can be tested without a server:
 *
 *   - the marker constant + a streaming-safe "how much of the accumulated
 *     text can I emit without leaking a partial marker" helper
 *   - splitting a completed response into {answer, proposalJson}
 *   - resolving the model's raw proposal against the STORED itinerary into
 *     the exact PendingChange shape PreviewChangeCard renders and
 *     /api/ai/assistant/apply accepts — the model only ever references
 *     activities by id; the server supplies the real stored objects, so a
 *     hallucinated "oldActivity" can never reach the apply endpoint.
 *   - telling when an answer that came without a proposal owes one, and
 *     reading the follow-up that asks for it
 *
 * Deliberately dependency-light (types + generateActivityId only) so the
 * route imports it without dragging UI code into the server bundle, and
 * vitest imports it without Next.js machinery.
 */

import type { PendingChange } from "@/lib/ai/assistant/pending-change";
import type { Activity, ItineraryDay } from "@/types";
import { generateActivityId } from "@/lib/utils/activity-id";
import { normalizeActivityType } from "@/lib/trip/activity-type";
import { addDaysISO } from "@/lib/ai/assistant/structural";
import { announcesProposal, claimsItineraryChange, isConfirmation, offersChange } from "@/lib/ai/assistant/honesty";

export const PROPOSAL_MARKER = "<<<PROPOSAL>>>";

/**
 * Change types the concierge may propose: single-activity edits plus the
 * Stage C structural primitive shift_days (the cancelled-flight case —
 * push every day from N onward K days later).
 */
const ALLOWED_TYPES = ["replace", "add", "remove", "adjust_duration", "shift_days"] as const;
type ProposalType = (typeof ALLOWED_TYPES)[number];

/** The proposals the concierge may make: these types of the shared PendingChange. */
export type ConciergeProposal = Extract<PendingChange, { type: ProposalType }>;

/**
 * How many chars of the accumulated stream are safe to emit to the client
 * right now. Everything before the marker is answer text; the marker and
 * what follows stay server-side. Because a chunk boundary can split the
 * marker, any trailing prefix of it is held back until the next chunk
 * proves it either is or isn't the real thing.
 */
export function emittableLength(accumulated: string): number {
  const idx = accumulated.indexOf(PROPOSAL_MARKER);
  if (idx !== -1) return idx;
  const maxCheck = Math.min(PROPOSAL_MARKER.length - 1, accumulated.length);
  for (let k = maxCheck; k > 0; k--) {
    if (accumulated.endsWith(PROPOSAL_MARKER.slice(0, k))) {
      return accumulated.length - k;
    }
  }
  return accumulated.length;
}

/** Split a COMPLETED response into the user-facing answer and the raw proposal JSON (or null). */
export function splitAnswerAndProposal(fullText: string): {
  answer: string;
  proposalJson: string | null;
} {
  const idx = fullText.indexOf(PROPOSAL_MARKER);
  if (idx === -1) return { answer: fullText.trim(), proposalJson: null };
  return {
    answer: fullText.slice(0, idx).trim(),
    proposalJson: fullText.slice(idx + PROPOSAL_MARKER.length).trim() || null,
  };
}

export type ProposalOwed = "promised" | "confirmed" | "offered";

/**
 * Why an answer that came without a proposal is owed one, or null: it handed
 * over or claimed a change ("Ecco la proposta per rimuovere…"), the question
 * was a bare "ok" to an earlier offer, or it offered a change ("Certo, posso
 * rimuovere la cena…") without asking anything back. Each went out with
 * nothing to confirm.
 */
export function proposalOwed(question: string, answer: string): ProposalOwed | null {
  if (announcesProposal(answer) || claimsItineraryChange(answer)) return "promised";
  if (isConfirmation(question)) return "confirmed";
  // A question back ("which day?") is a fine answer to a request.
  if (offersChange(answer) && !answer.includes("?")) return "offered";
  return null;
}

/** The follow-up that asks for the owed proposal line alone. */
export function proposalRequest(owed: ProposalOwed): string {
  const why =
    owed === "confirmed"
      ? "The traveller's message agrees to a change offered earlier in this conversation, but your answer has no proposal line"
      : "Your answer offers a change to the plan, but its proposal line is missing";
  return `${why}, so there is nothing to confirm. Reply with ONLY that proposal line, for exactly that change: ${PROPOSAL_MARKER} followed by the minified JSON, with its dayNumber. If no specific change was offered or asked for, reply NONE.`;
}

/**
 * The follow-up's reply: the proposal JSON, with or without the marker, or
 * "none" when the model says there was no change to propose.
 */
export function requestedProposalJson(text: string): string | "none" | null {
  if (/^\W*none\W*$/i.test(text)) return "none";
  const json = (splitAnswerAndProposal(text).proposalJson ?? text.trim())
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();
  return json.startsWith("{") ? json : null;
}

function isLocked(a: Activity | undefined): boolean {
  return (a as { locked?: boolean } | undefined)?.locked === true;
}

function findActivity(
  day: ItineraryDay,
  id: unknown,
  name: unknown
): Activity | undefined {
  const acts = day.activities ?? [];
  if (typeof id === "string" && id) {
    const byId = acts.find((a) => a.id === id);
    if (byId) return byId;
  }
  if (typeof name === "string" && name) {
    return acts.find((a) => a.name === name);
  }
  return undefined;
}

function timeSlotFor(startTime: string): "morning" | "afternoon" | "evening" {
  const hour = Number(startTime.slice(0, 2));
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Build a fully valid Activity from whatever fields the model produced.
 * Every missing/malformed field gets a safe default — a proposal must never
 * put a half-formed activity into the itinerary, because downstream renderers
 * (cost pill, timeline math, the feasibility strip) assume the full shape.
 */
function sanitizeNewActivity(
  raw: Record<string, unknown>,
  currency: string,
  inheritStartTime?: string
): Activity | null {
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 120) : "";
  if (!name) return null;

  const startTime =
    typeof raw.start_time === "string" && HHMM.test(raw.start_time)
      ? raw.start_time
      : inheritStartTime && HHMM.test(inheritStartTime)
        ? inheritStartTime
        : "12:00";

  const duration =
    typeof raw.duration_minutes === "number" &&
    Number.isFinite(raw.duration_minutes)
      ? Math.min(480, Math.max(15, Math.round(raw.duration_minutes)))
      : 90;

  const rawCost = raw.estimated_cost as
    | { amount?: unknown; currency?: unknown; tier?: unknown }
    | undefined;
  const amount =
    typeof rawCost?.amount === "number" && rawCost.amount >= 0
      ? Math.round(rawCost.amount)
      : 0;
  const tier =
    rawCost?.tier === "budget" || rawCost?.tier === "moderate" || rawCost?.tier === "premium"
      ? rawCost.tier
      : amount === 0
        ? "free"
        : "moderate";

  return {
    id: generateActivityId(),
    name,
    type: normalizeActivityType(raw.type, name),
    description:
      typeof raw.description === "string" ? raw.description.slice(0, 500) : "",
    location: typeof raw.location === "string" ? raw.location.slice(0, 200) : "",
    address: typeof raw.address === "string" ? raw.address.slice(0, 200) : undefined,
    time_slot: timeSlotFor(startTime),
    start_time: startTime,
    duration_minutes: duration,
    estimated_cost: {
      amount,
      currency:
        typeof rawCost?.currency === "string" && rawCost.currency.length === 3
          ? rawCost.currency.toUpperCase()
          : currency,
      tier,
    },
    tips: [],
    booking_required: false,
  } as Activity;
}

/**
 * Resolve the model's raw proposal JSON against the stored itinerary.
 * Returns null (silently drop the proposal, keep the answer) on anything
 * that doesn't check out: unknown type, day not in the trip, target not
 * found, target locked (anchors stay user-owned — same rule /apply
 * enforces, applied here too so a locked target never even renders a card).
 */
export function resolveConciergeProposal(
  proposalJson: string,
  itinerary: ItineraryDay[],
  currency = "USD"
): ConciergeProposal | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(proposalJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const type = raw.type as ProposalType;
  if (!ALLOWED_TYPES.includes(type)) return null;

  // A change to a stored activity happens on the day that holds it. The field
  // rules once asked remove for the activity's id alone, and every removal
  // came without its day and was dropped.
  const targetId = type !== "add" && type !== "shift_days" ? raw.targetActivityId : undefined;
  const held =
    typeof targetId === "string" && targetId
      ? itinerary.find((d) => (d.activities ?? []).some((a) => a.id === targetId))
      : undefined;
  const day = held ?? itinerary.find((d) => d.day_number === raw.dayNumber);
  if (!day) return null;
  const dayNumber = day.day_number;

  const reason =
    typeof raw.reason === "string" && raw.reason.trim()
      ? raw.reason.trim().slice(0, 300)
      : undefined;

  if (type === "add") {
    const newActivity = sanitizeNewActivity(
      (raw.newActivity as Record<string, unknown>) ?? {},
      currency
    );
    if (!newActivity) return null;
    return { type, newActivity, dayNumber, reason };
  }

  if (type === "shift_days") {
    const k =
      typeof raw.shiftByDays === "number" &&
      Number.isInteger(raw.shiftByDays) &&
      raw.shiftByDays >= 1 &&
      raw.shiftByDays <= 7
        ? raw.shiftByDays
        : null;
    if (k === null) return null;
    const affected = itinerary.filter((d) => d.day_number >= dayNumber);
    if (affected.length === 0) return null;
    // Same rule /apply enforces: a date-pinned commitment in the affected
    // range makes the shift undoable — drop the proposal, keep the answer.
    if (affected.some((d) => (d.activities ?? []).some((a) => isLocked(a)))) {
      return null;
    }
    const lastDay = affected[affected.length - 1];
    return {
      type,
      dayNumber,
      shiftByDays: k,
      lastDayNumber: lastDay.day_number,
      newLastDate: addDaysISO(lastDay.date, k) ?? undefined,
      reason,
    };
  }

  // Remaining types all target a stored activity.
  const target = findActivity(day, raw.targetActivityId, raw.targetActivityName);
  if (!target || isLocked(target)) return null;

  if (type === "remove") {
    return { type, oldActivity: target, dayNumber, reason };
  }

  if (type === "replace") {
    const newActivity = sanitizeNewActivity(
      (raw.newActivity as Record<string, unknown>) ?? {},
      currency,
      target.start_time
    );
    if (!newActivity) return null;
    return { type, oldActivity: target, newActivity, dayNumber, reason };
  }

  // adjust_duration
  const newDuration =
    typeof raw.newDuration === "number" && Number.isFinite(raw.newDuration)
      ? Math.min(480, Math.max(15, Math.round(raw.newDuration)))
      : null;
  if (newDuration === null) return null;
  return {
    type: "adjust_duration",
    activity: {
      id: target.id ?? "",
      name: target.name,
      type: String(target.type ?? "activity"),
    },
    oldDuration: target.duration_minutes || 60,
    newDuration,
    dayNumber,
    reason,
  };
}
