"use client";

import { memo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import ClosingNote from "@/components/trip/ClosingNote";
import PickedByNote from "@/components/trip/PickedByNote";
import UnverifiedNote from "@/components/trip/UnverifiedNote";
import ActivityDetailSheet from "@/components/ui/ActivityDetailSheet";
import { getActivityTypeColors } from "@/lib/constants/activityColors";
import { formatDuration } from "@/lib/datetime/duration";
import { useActivityPrice } from "@/lib/i18n/activity-price";
import { useActivityTypeLabel } from "@/lib/i18n/activity-type";
import { proxyImageUrl } from "@/lib/img/proxyUrl";
import { activityDomId } from "@/lib/trip/activity-dom-id";
import { normalizeActivityType } from "@/lib/trip/activity-type";
import type { Activity } from "@/types";

/** Whether a stop carries a note the traveller must not miss, which stays on its row. */
export function hasStopNote(activity: Pick<Activity, "unverified" | "picked_by" | "closing">): boolean {
  const picked = typeof activity.picked_by === "string" && activity.picked_by.trim() !== "";
  return Boolean(activity.unverified) || picked || Boolean(activity.closing?.dates?.length);
}

/**
 * One stop of a day on a phone: when, what, what kind and what it costs, beside its picture, in a row that opens
 * the stop's sheet. The description, the address, the photo's credit and the ways out to a map or the place's own
 * page are in the sheet. A note that can't wait for a tap (not found on the map, shut on one of the dates, a
 * friend's pick) stays on the row, as does what a page adds under a stop (`extra`, such as its votes).
 */
function StopRow({
  activity,
  currency = "USD",
  disableAutoFetch = true,
  extra,
}: {
  activity: Activity;
  /** The trip's currency, for an estimate that names none. */
  currency?: string;
  /** Photos in the sheet load on a tap, not by themselves. */
  disableAutoFetch?: boolean;
  extra?: ReactNode;
}) {
  const t = useTranslations("common");
  const typeLabel = useActivityTypeLabel();
  const priceOf = useActivityPrice();
  const [open, setOpen] = useState(false);
  // A photo that no longer loads gives way to the kind's mark.
  const [lost, setLost] = useState(false);

  const kind = normalizeActivityType(activity.type, activity.name);
  const colors = getActivityTypeColors(kind);
  const price = priceOf(activity, currency);
  const estimate = price !== null && price !== t("activity.free");
  const picture = activity.image_url ? proxyImageUrl(activity.image_url) || activity.image_url : null;

  return (
    <li id={activityDomId(activity)} data-activity-name={activity.name} className="scroll-mt-24">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors active:bg-[var(--background-warm)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--foreground)]"
      >
        <span data-ink="off" className={`flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl ${colors.bg}`}>
          {picture && !lost ? (
            // The sheet shows the picture large, with its credit.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picture} alt="" loading="lazy" onError={() => setLost(true)} className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true" className="text-2xl leading-none">
              {colors.icon}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3 text-sm text-[var(--foreground-muted)]">
            <span className="truncate">
              {activity.start_time && <span className="font-semibold tabular-nums text-[var(--foreground)]">{activity.start_time}</span>}
              {activity.start_time && activity.duration_minutes > 0 && " · "}
              {activity.duration_minutes > 0 && formatDuration(activity.duration_minutes)}
            </span>
            {price !== null && (
              <span className="flex-shrink-0 font-semibold tabular-nums text-[var(--foreground)]">
                {estimate && <span className="font-normal text-[var(--foreground-muted)]">~</span>}
                {price}
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-start gap-2">
            <span className="line-clamp-2 flex-1 text-base font-semibold leading-snug text-[var(--foreground)]">
              {activity.locked && (
                <span className="mr-1" role="img" aria-label={t("lockedActivity")}>
                  📌
                </span>
              )}
              {activity.name}
            </span>
            <ChevronRight className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--foreground-light)]" aria-hidden="true" />
          </span>
          <span className="mt-0.5 block truncate text-sm text-[var(--foreground-muted)]">
            {typeLabel(kind)}
            {activity.booking_required && <> · {t("activity.booking")}</>}
          </span>
        </span>
      </button>
      {(hasStopNote(activity) || extra) && (
        // Under the words, clear of the picture: these have links and buttons of their own.
        <div className="-mt-1 pb-3 pl-[88px] pr-3">
          <UnverifiedNote activity={activity} />
          <PickedByNote activity={activity} />
          <ClosingNote activity={activity} className="text-[var(--foreground-muted)]" />
          {extra}
        </div>
      )}
      <ActivityDetailSheet
        activity={activity}
        currency={currency}
        isOpen={open}
        onClose={() => setOpen(false)}
        disableAutoFetch={disableAutoFetch}
      />
    </li>
  );
}

export default memo(StopRow);

/** A day's stops as one drawn box of rows. */
export function StopRows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ol aria-label={label} className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {children}
    </ol>
  );
}
