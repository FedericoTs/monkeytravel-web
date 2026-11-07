"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import UnverifiedNote from "@/components/trip/UnverifiedNote";
import { PhotoCredit } from "@/components/ui/PhotoCredit";
import { formatDuration } from "@/lib/datetime/duration";
import { useActivityPrice } from "@/lib/i18n/activity-price";
import { proxyImageUrl } from "@/lib/img/proxyUrl";
import { openExternal } from "@/lib/native/external-link";
import { activityDomId } from "@/lib/trip/activity-dom-id";
import { placeMapsUrl, placeSearchUrl } from "@/lib/trips/maps-links";
import type { Activity } from "@/types";
import styles from "./sky.module.css";

const action = "inline-flex min-h-[44px] items-center font-semibold underline decoration-1 underline-offset-[3px]";

/**
 * One stop on the day's line: its time, name and photo, two lines about it, and
 * how long, how much and whether to book. A tap opens the tips and the ways to
 * look it up. `minutes` places it in the sky, and `until` the words under its
 * photo, so the light changes behind the photo as the stop goes on.
 */
export default function SkyStop({ activity, currency, minutes, until }: { activity: Activity; currency: string; minutes: number; until: number }) {
  const t = useTranslations("common");
  const tTrips = useTranslations("trips");
  const priceOf = useActivityPrice();
  const [open, setOpen] = useState(false);
  const id = activityDomId(activity);
  const price = priceOf(activity, currency);
  const meta = [
    formatDuration(activity.duration_minutes),
    price,
    activity.booking_required ? tTrips("wizard.result.sky.bookAhead") : null,
    activity.locked ? t("lockedActivity") : null,
  ].filter(Boolean);
  const photo = activity.image_url ? proxyImageUrl(activity.image_url) || activity.image_url : null;

  return (
    <li id={id} data-t={minutes} data-activity-name={activity.name} className={`${styles.stop} scroll-mt-24`}>
      <p data-ink className={`${styles.time} text-[1.0625rem] font-semibold tabular-nums`}>
        {activity.start_time}
      </p>
      <h3 data-ink className="mb-3 mt-0.5 text-[1.7rem] font-medium leading-[1.14] tracking-[-0.01em]">
        {activity.name}
      </h3>
      <div className="relative">
        <button type="button" onClick={() => setOpen((was) => !was)} aria-expanded={open} aria-controls={`${id}-more`} className="block w-full text-left">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- remote photos through our proxy, as in ActivityCard
            <img src={photo} alt="" loading="lazy" className={`${styles.photo} mb-3 block aspect-[16/10] w-full rounded-[20px] bg-white/20 object-cover`} />
          )}
          <span data-t={until} data-ink className={`block text-[1.0625rem] leading-[1.45] ${open ? "" : styles.clamp}`}>
            {activity.description}
          </span>
          <span data-ink className="mt-1.5 block text-base">
            {meta.join(", ")}
          </span>
        </button>
        {photo && <PhotoCredit src={activity.image_url} className="right-2 top-2" />}
      </div>
      {activity.unverified && (
        <div className="mt-2 inline-block rounded-lg bg-white/90 px-2.5 py-1">
          <UnverifiedNote activity={activity} />
        </div>
      )}
      {open && (
        <div id={`${id}-more`} data-ink className="mt-3">
          {activity.tips?.length ? (
            <ul className="space-y-1.5">
              {activity.tips.map((tip) => (
                <li key={tip} className="text-[1.03rem] leading-[1.42]">
                  {tip}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-x-5">
            <button type="button" className={action} onClick={() => void openExternal(placeMapsUrl(activity))}>
              {t("buttons.maps")}
            </button>
            <button type="button" className={action} onClick={() => void openExternal(placeSearchUrl(activity))}>
              {t("buttons.verify")}
            </button>
            {activity.official_website && (
              <button type="button" className={action} onClick={() => void openExternal(activity.official_website!)}>
                {t("buttons.website")}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
