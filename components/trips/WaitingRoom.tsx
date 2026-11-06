"use client";

import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import { formatDateRange } from "@/lib/datetime";
import { capture } from "@/lib/posthog";
import { dayDiff } from "@/lib/trip/live";
import { waitingStage, type WaitingRoomTrip, type WaitingStage } from "@/lib/trips/waiting-room";

const CARD_LINK =
  "inline-flex min-h-[44px] w-fit items-center rounded-xl bg-[var(--secondary-ink)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--secondary-ink)]/90";

/** What's useful at this distance from departure, from what the plan already holds. */
function stageCard(trip: WaitingRoomTrip, stage: WaitingStage, t: ReturnType<typeof useTranslations>) {
  if (stage === "during") {
    return { label: t("today"), lines: [], cta: t("openToday"), href: `/trips/${trip.id}` };
  }
  if (stage === "days") {
    return {
      label: t("beforeYouGo"),
      lines: trip.firstStop ? [t("dayOneStarts", { place: trip.firstStop })] : [],
      cta: t("openDayOne"),
      href: `/trips/${trip.id}`,
    };
  }
  if (stage === "weeks" && trip.packing.length > 0) {
    return { label: t("worthSorting"), lines: trip.packing, cta: t("packingList"), href: `/trips/${trip.id}` };
  }
  return { label: t("whileYouWait"), lines: trip.highlights, cta: t("lookThrough"), href: `/trips/${trip.id}` };
}

export default function WaitingRoom({ trip, today, holdout = false }: { trip: WaitingRoomTrip; today: string; holdout?: boolean }) {
  const t = useTranslations("common.waitingRoom");
  const locale = useLocale();
  const daysToGo = dayDiff(today, trip.startDate);
  const stage = waitingStage(daysToGo);

  useEffect(() => {
    void capture("waiting_room_seen", { arm: holdout ? "holdout" : "shown", stage, pencilled: trip.pencilled });
    // Once a visit, however the page's clock moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (holdout) return null;

  const card = trip.pencilled
    ? { label: t("datesLabel"), lines: [t("datesNote")], cta: t("setDates"), href: `/trips/${trip.id}` }
    : stageCard(trip, stage, t);

  return (
    <section
      aria-labelledby="waiting-room-trip"
      data-testid="waiting-room"
      className="mb-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:mb-8 sm:grid-cols-2 sm:p-6"
    >
      <div className="flex flex-col gap-1 border-l-4 border-[var(--primary)] pl-4">
        <h2 id="waiting-room-trip" className="font-display text-2xl font-bold text-slate-900">
          {trip.title}
        </h2>
        <p className="text-sm text-slate-600">
          {stage === "during"
            ? t("dayOf", { day: dayDiff(trip.startDate, today) + 1, total: dayDiff(trip.startDate, trip.endDate) + 1 })
            : formatDateRange(trip.startDate, trip.endDate, locale)}
        </p>
        {!trip.pencilled && stage !== "during" && (
          <p className="mt-1 font-display text-4xl font-bold text-slate-900 tabular-nums">
            {daysToGo}
            <span className="ml-2 font-sans text-sm font-medium text-slate-600">{t("daysToGo", { count: daysToGo })}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
        {card.lines.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-slate-700">
            {card.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <Link
          href={card.href}
          prefetch={false}
          onClick={() => void capture("waiting_room_card_clicked", { stage, pencilled: trip.pencilled })}
          className={CARD_LINK}
        >
          {card.cta}
        </Link>
      </div>
    </section>
  );
}
