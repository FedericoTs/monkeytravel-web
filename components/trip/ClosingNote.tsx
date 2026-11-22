"use client";

import { useLocale, useTranslations } from "next-intl";
import { openExternal } from "@/lib/native/external-link";
import type { Activity } from "@/types";

/** How many dates are named; past that, the last named place says how many more. */
const NAMED = 3;
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Says which of the trip's dates a place is shut on, with the official page that says so: the checked list of
 * closing days found it (lib/ai/known-closings.ts withClosingNotes), so the plan keeps it off those days.
 */
export default function ClosingNote({ activity, className = "" }: { activity: Pick<Activity, "closing">; className?: string }) {
  const t = useTranslations("common.activity");
  const locale = useLocale();
  const closing = activity.closing;
  const dates = (closing?.dates ?? []).filter(isDate);
  if (!closing || dates.length === 0 || !/^https:\/\//.test(closing.source)) return null;
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const named = dates.length > NAMED ? dates.slice(0, NAMED - 1) : dates;
  const parts = named.map((date) => day.format(new Date(`${date}T00:00:00Z`)));
  if (dates.length > named.length) parts.push(t("closedMoreDays", { count: dates.length - named.length }));
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(parts);
  return (
    <p className={`mt-1 text-xs ${className}`}>
      {t("closedOn", { dates: list })}
      {" · "}
      <button
        type="button"
        className="underline underline-offset-2"
        onClick={(event) => {
          // The card around it opens on a tap of its own.
          event.stopPropagation();
          void openExternal(closing.source);
        }}
      >
        {t("closedSource")}
      </button>
    </p>
  );
}
