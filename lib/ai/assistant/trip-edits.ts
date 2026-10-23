/**
 * Requests on a saved trip, through the wizard's edit engine.
 *
 * The trip page's assistant read requests with keyword patterns
 * (detectActionIntent in app/api/ai/assistant/route.ts): "replace X with Y",
 * "add X to day N" and a few more produced a change, anything else none.
 * "Adding Wigwam to Day 3", "nightclubs on the 2nd, 4th and 6th night" or two
 * changes in one message got a reply promising the change, and no change.
 * The wizard's engine (lib/ai/assistant-anon.ts) has the model write the
 * revised days itself, from the whole plan and the conversation; here those
 * days are merged into the saved trip and proposed as one multi-day change.
 * It answers questions too, with the plan's own figures.
 */

import { assistTrip, type AssistTurn, type DayEdit } from "@/lib/ai/assistant-anon";
import { lengthUnchangedNote } from "@/lib/ai/assistant/honesty";
import type { DisplayCurrency } from "@/lib/ai/assistant/plan-costs";
import { applyAssistantEdits } from "@/lib/trips/day-edit-merge";
import type { Activity, ItineraryDay } from "@/types";

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
  /** The currency the page shows prices in, so the reply's figures match it. */
  display?: DisplayCurrency;
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
