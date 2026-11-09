/**
 * Requests on a saved trip, through the wizard's edit engine.
 *
 * The engine (lib/ai/assistant/engine.ts) has the model write the revised
 * days itself, from the whole plan and the conversation, so a change asked in
 * any words ("adding Wigwam to Day 3", "nightclubs on the 2nd, 4th and 6th
 * night", two changes in one message) is made. Here those days are merged
 * into the saved trip and proposed as one multi-day change. It answers
 * questions too, with the plan's own figures.
 */

import type { AssistTurn } from "./edit-prompt";
import type { DayEdit } from "./edit-validation";
import { assistTrip } from "./engine";
import { lengthUnchangedNote, ownerAddsDaysReply, waitingKeptNote } from "@/lib/ai/assistant/honesty";
import type { DisplayCurrency } from "@/lib/ai/assistant/plan-costs";
import { addDaysISO, computeExtendedEndDate } from "@/lib/ai/assistant/structural";
import { validateAndFixCoordinates } from "@/lib/trip/coordinate-fallback";
import { applyAssistantEdits } from "@/lib/trips/day-edit-merge";
import { generateActivityId } from "@/lib/utils/activity-id";
import type { Activity, ItineraryDay, StructuredAssistantResponse } from "@/types";

/** The currency the page shows prices in, when the request names a sane one. */
export function readDisplayCurrency(raw: unknown): DisplayCurrency | undefined {
  const d = raw as { currency?: unknown; rate?: unknown } | null | undefined;
  const ok =
    typeof d?.currency === "string" &&
    /^[A-Z]{3}$/.test(d.currency) &&
    typeof d.rate === "number" &&
    d.rate > 0 &&
    d.rate <= 1_000_000;
  return ok ? { currency: d.currency as string, rate: d.rate as number } : undefined;
}

/**
 * The saved conversation, as the engine reads it, oldest first: the last six
 * turns, and before them the traveller's own messages (what they said about
 * the trip, like when they land, still holds).
 */
export function conversationTurns(messages: { role?: unknown; content?: unknown }[] | null | undefined): AssistTurn[] {
  const turns = (messages ?? [])
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "",
    )
    .map((m) => ({ role: m.role, text: m.content }));
  const earlier = turns.slice(0, -6).filter((t) => t.role === "user").slice(-10);
  return [...earlier, ...turns.slice(-6)];
}

/**
 * The engine's new days as days of the saved trip: numbered and dated after
 * its last day, in that day's city unless the edit names another, every
 * activity with an id. /apply numbers and dates them again from the stored trip.
 */
export function newTripDays(days: ItineraryDay[], edits: DayEdit[], endDate?: string): ItineraryDay[] {
  const last = days[days.length - 1];
  const from = last?.date || endDate;
  return edits
    .filter((e) => e.day_number > days.length)
    .sort((a, b) => a.day_number - b.day_number)
    .map((e, i) => {
      const city = e.city ?? last?.city;
      return {
        day_number: days.length + 1 + i,
        date: addDaysISO(from, i + 1) ?? "",
        ...(e.theme ? { theme: e.theme } : {}),
        ...(city ? { city } : {}),
        activities: e.activities.map((a) => ({ ...a, id: generateActivityId() })),
      };
    });
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

/** The change still waiting for its button when the traveller wrote again, as the page sends it back. */
export interface WaitingChange {
  /** Days of the trip, as the change would save them. */
  days: ItineraryDay[];
  /** What the card said it does. */
  reason?: string;
}

/** The waiting change, if the request carries one about days this trip has. */
export function readWaitingChange(raw: unknown, tripDays: number): WaitingChange | undefined {
  const w = raw as { days?: unknown; reason?: unknown } | null | undefined;
  if (!Array.isArray(w?.days)) return undefined;
  const days = (w.days as unknown[]).filter((d): d is ItineraryDay => {
    const day = d as ItineraryDay | null;
    return (
      Number.isInteger(day?.day_number) &&
      day!.day_number >= 1 &&
      day!.day_number <= tripDays &&
      Array.isArray(day!.activities) &&
      day!.activities.every((a) => typeof a?.name === "string")
    );
  });
  if (days.length === 0) return undefined;
  return { days: days.slice(0, tripDays), ...(typeof w?.reason === "string" ? { reason: w.reason.slice(0, 600) } : {}) };
}

const nameOf = (a: { name?: unknown } | null | undefined) => (typeof a?.name === "string" ? a.name.trim() : "");

/** What a waiting change does to each of its days, for the engine: "Day 2: adds X; takes out Y". */
export function waitingLines(days: ItineraryDay[], waiting: ItineraryDay[]): string[] {
  return waiting.map((w) => {
    const before = (days.find((d) => d.day_number === w.day_number)?.activities ?? []).map(nameOf);
    const after = w.activities.map(nameOf);
    const adds = after.filter((n) => n && !before.includes(n));
    const out = before.filter((n) => n && !after.includes(n));
    const parts = [adds.length ? `adds ${adds.join(", ")}` : "", out.length ? `takes out ${out.join(", ")}` : ""].filter(Boolean);
    return `Day ${w.day_number}: ${parts.join("; ") || "changes times"}`;
  });
}

/** Does this day hold what the saved day holds, by name and time, in order? */
function asSaved(days: ItineraryDay[], day: ItineraryDay): boolean {
  const saved = days.find((d) => d.day_number === day.day_number)?.activities ?? [];
  return (
    saved.length === day.activities.length &&
    saved.every((a, i) => nameOf(a) === nameOf(day.activities[i]) && a?.start_time === day.activities[i]?.start_time)
  );
}

export interface TripEditProposal {
  reply: string;
  /** The revised days, merged into the saved trip, then any new days; empty when nothing changes. */
  revisedDays: ItineraryDay[];
  /** The trip's new number of days, when the change adds days. */
  tripLength?: number;
  /** What changes, day by day, for the preview card. */
  summary: string;
  /** The change that was waiting for its button is part of this one. */
  waitingKept?: true;
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
  /** The currency the page shows prices in, so the reply's figures match it. */
  display?: DisplayCurrency;
  /** The trip's owner may add days: they move its dates (lib/ai/assistant-access.ts). */
  canAddDays?: boolean;
  /**
   * The change a previous reply prepared, still waiting for its button. The
   * engine reads the plan with it and what it does, so a request that builds
   * on it ("add the others too") keeps it, and one that turns it down undoes it.
   */
  waiting?: WaitingChange;
}): Promise<TripEditProposal | null> {
  const { canAddDays, waiting, ...ask } = input;
  const current = input.days.length;
  const held = (waiting?.days ?? []).filter((w) => w.day_number >= 1 && w.day_number <= current);
  const view = held.length ? input.days.map((d) => held.find((w) => w.day_number === d.day_number) ?? d) : input.days;
  // The change waits for this page's button, which the route's reply names.
  // Only the owner adds days, and the engine is told so.
  const result = await assistTrip({
    ...ask,
    days: view,
    ...(held.length ? { unsaved: waitingLines(input.days, held) } : {}),
    canAddDays: canAddDays === true,
    autoApply: false,
    ownLead: true,
  });
  if (result.currency) return null;

  // The owner's longer trip gets its new days ("aggiungi altri 7 giorni" used
  // to answer that the trip stays at 7 days). A shorter trip is made by moving
  // the dates, so that one keeps its length. Edits to the existing days stand.
  const longer = result.tripLength !== undefined && result.tripLength > current;
  const adds = longer && canAddDays === true;
  const edits = result.edits.filter((e) => e.day_number <= current);
  const label = DAY_LABEL[input.locale] ?? DAY_LABEL.en;
  let reply = result.reply;
  if (longer && !adds) {
    // New days an editor got anyway become ideas to pass on to the owner; the
    // reply about them goes too, unless it also covers changes that stand.
    const ideas = result.edits
      .filter((e) => e.day_number > current)
      .map((e) => `${label} ${e.day_number}: ${e.summary.trim() || e.activities.map((a) => a.name).join(", ")}`);
    const owner = ownerAddsDaysReply(input.locale, current, ideas);
    reply = edits.length > 0 ? `${result.reply}\n\n${owner}` : owner;
  } else if (result.tripLength !== undefined && !adds) {
    reply = `${result.reply} ${lengthUnchangedNote(input.locale, current)}`;
  }

  const added = adds ? newTripDays(input.days, result.edits, input.endDate) : [];
  const merged = edits.length > 0 ? mergeTripEdits(input.days, edits) : [];
  // The waiting change stays in this one, under what this reply changes; a day
  // the reply puts back as it was saved changes nothing, and goes.
  const carried = held.filter((w) => !merged.some((m) => m.day_number === w.day_number));
  const revisedDays = [
    ...[...merged, ...carried].sort((a, b) => a.day_number - b.day_number).filter((d) => !asSaved(input.days, d)),
    ...added,
  ];
  const waitingKept = held.length > 0 && revisedDays.some((d) => held.some((w) => w.day_number === d.day_number));
  if (waitingKept && edits.length > 0 && carried.some((d) => !asSaved(input.days, d))) {
    reply = `${reply} ${waitingKeptNote(input.locale)}`;
  }
  // The model can swap out a saved activity while its reply calls the change
  // an addition, so the card names what the change takes out before Apply.
  const removed = leftOut(input.days, revisedDays);
  const summary = [
    carried.length && waiting?.reason ? waiting.reason.trim() : "",
    ...(adds ? result.edits : edits).filter((e) => e.summary.trim()).map((e) => `${label} ${e.day_number}: ${e.summary.trim()}`),
  ]
    .filter(Boolean)
    .join(" ");
  return {
    reply,
    revisedDays,
    ...(added.length > 0 ? { tripLength: current + added.length } : {}),
    summary: removed.length
      ? `${summary} ${LEAVES_OUT[input.locale] ?? LEAVES_OUT.en}: ${removed.join(", ")}.`.trim()
      : summary,
    ...(waitingKept ? { waitingKept: true as const } : {}),
    meta: result.meta,
  };
}

/**
 * The proposal as the change waiting for the user's confirm: one multi-day
 * change (apply_draft), saved in one write like a pasted draft. Days past the
 * last one go after it, and the trip's end date moves with them. Undefined
 * when the proposal changes no day.
 */
export function proposedChange(
  proposal: TripEditProposal,
  trip: { days: ItineraryDay[]; destination: string; endDate: string | null | undefined }
): NonNullable<StructuredAssistantResponse["action"]> | undefined {
  if (proposal.revisedDays.length === 0) return undefined;
  const revisedDays = validateAndFixCoordinates(proposal.revisedDays, trip.destination);
  const days = [...trip.days];
  for (const day of revisedDays) {
    const idx = days.findIndex((d) => d.day_number === day.day_number);
    if (idx !== -1) days[idx] = day;
    else days.push(day);
  }
  const lastDate = days[days.length - 1]?.date;
  const newEndDate =
    days.length > trip.days.length && lastDate ? (computeExtendedEndDate(trip.endDate, lastDate) ?? undefined) : undefined;
  return {
    type: "apply_draft",
    applied: false,
    dayNumber: revisedDays[0].day_number,
    dayCount: revisedDays.length,
    revisedDays,
    ...(newEndDate ? { newEndDate } : {}),
  };
}
