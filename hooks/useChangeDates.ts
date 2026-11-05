"use client";

import { useCallback, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addIsoDaysOrThrow } from "@/lib/dates/iso-date";
import { usePostHog } from "@/lib/posthog";
import { extraDaysAsk, extraDaysFrom, moveItineraryDates, planDateChange } from "@/lib/trips/change-dates";
import type { AssistantDayEdit } from "@/lib/trips/day-edit-merge";
import { withDays } from "@/lib/trips/plan-days";
import { newTripTitle } from "@/lib/trips/title";
import type { GeneratedItinerary } from "@/types";

/**
 * New dates for the wizard's generated trip, from the hero's date chip or from
 * Start Over's "wrong dates" (often dates "I'm flexible" pencilled in), so wrong
 * dates don't cost the whole plan. The plan moves with the dates; a shorter trip
 * keeps its first days; a longer one gets its new days from the assistant (only
 * the new days: the ones already planned stay exactly as they are).
 *
 * `datesNotice` reports a longer trip whose extra days could not be planned. A
 * plan that replaces this one calls `forgetDatesChange`: the note and the extra
 * days still being planned were this plan's.
 */
export function useChangeDates({
  plan,
  onPlan,
  onDates,
}: {
  plan: GeneratedItinerary | null;
  onPlan: (update: (prev: GeneratedItinerary | null) => GeneratedItinerary | null) => void;
  /** The start the traveller chose, and the last day the plan now reaches. */
  onDates: (start: string, end: string) => void;
}) {
  const t = useTranslations("trips");
  const locale = useLocale();
  const posthog = usePostHog();
  const [showChangeDates, setShowChangeDates] = useState(false);
  const [planningExtraDays, setPlanningExtraDays] = useState(false);
  const [datesNotice, setDatesNotice] = useState<string | null>(null);
  const extraDaysRequest = useRef<AbortController | null>(null);

  const forgetDatesChange = useCallback(() => {
    extraDaysRequest.current?.abort();
    extraDaysRequest.current = null;
    setPlanningExtraDays(false);
    setDatesNotice(null);
  }, []);

  const changeDates = async (
    start: string,
    end: string,
    {
      maxDays,
      applyEdits,
    }: { maxDays: number; applyEdits: (edits: AssistantDayEdit[], tripLength?: number) => string | undefined }
  ) => {
    const itinerary = plan;
    if (!itinerary) return;
    const current = itinerary.days.length;
    const change = planDateChange(current, start, end, maxDays);
    if (change.kind === "invalid") return;
    setShowChangeDates(false);
    forgetDatesChange();
    const keep = Math.min(current, change.length);
    const moved = moveItineraryDates(itinerary.days, start, keep);
    onPlan((prev) => (prev ? withDays(prev, moveItineraryDates(prev.days, start, keep)) : prev));
    onDates(start, addIsoDaysOrThrow(start, keep - 1));
    posthog?.capture("wizard_dates_changed", { from_days: current, to_days: change.length, kind: change.kind });
    if (change.kind !== "longer") return;

    const request = new AbortController();
    extraDaysRequest.current = request;
    setPlanningExtraDays(true);
    try {
      const res = await fetch("/api/ai/assistant-anon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify(
          extraDaysAsk({
            itinerary,
            moved,
            start,
            current,
            length: change.length,
            tripTitle: newTripTitle(itinerary.destination.name, locale),
            locale,
          })
        ),
      });
      const reply = await res.json().catch(() => ({}));
      if (request.signal.aborted) return;
      const { planned, newDays } = extraDaysFrom(reply, current, change.length);
      if (res.ok && planned > current && newDays.length > 0) {
        applyEdits(newDays, planned);
        if (planned < change.length) setDatesNotice(t("wizard.changeDates.partlyPlanned", { count: planned }));
      } else {
        setDatesNotice(t("wizard.changeDates.extraFailed", { count: current }));
      }
    } catch {
      if (!request.signal.aborted) setDatesNotice(t("wizard.changeDates.extraFailed", { count: current }));
    } finally {
      if (!request.signal.aborted) setPlanningExtraDays(false);
    }
  };

  return { showChangeDates, setShowChangeDates, planningExtraDays, datesNotice, forgetDatesChange, changeDates };
}
