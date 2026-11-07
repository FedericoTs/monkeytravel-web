"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DayRouteLink } from "@/components/trip/DayRouteLink";
import { PackedDayNote } from "@/components/trip/PackedDayNote";
import { useCurrency } from "@/lib/locale";
import { skyGradient, timeAtY } from "@/lib/sky/layout";
import { inkFor, skyAt, skyStops, toCss, type Rgb } from "@/lib/sky/sky";
import { sunTimes, type SunTimes } from "@/lib/sky/sun";
import { dayBudgetLabel, showsDayBudget } from "@/lib/trip/day-budget";
import { isValidTimeZone } from "@/lib/trip/live";
import { lightenDayRequest } from "@/lib/trip/pace";
import type { Activity, GeneratedItinerary, ItineraryDay } from "@/types";
import SkyStop from "./SkyStop";
import styles from "./sky.module.css";

const DAY = 1440;
/** The light of an ordinary spring day, for a plan that doesn't say where or when; its times aren't shown. */
const ORDINARY: SunTimes = { sunrise: 390, sunset: 1170, polar: null };
/** The page under the sky, which the last night fades into. */
const PAGE = "rgb(248 250 252)";

const toMinutes = (clock: string | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(clock ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const clockOf = (minutes: number) => {
  const m = ((Math.round(minutes) % DAY) + DAY) % DAY;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

function kmBetween(a: Activity["coordinates"], b: Activity["coordinates"]): number | null {
  if (!a || !b) return null;
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

interface DaySky {
  sun: SunTimes;
  /** The sun times are the real ones for this place and date. */
  known: boolean;
  stops: Array<[number, Rgb]>;
  first: number;
  end: number;
}

function skyOfDay(day: ItineraryDay, timeZone: string | undefined): DaySky {
  const where = day.activities.find((a) => a.coordinates && (a.coordinates.lat !== 0 || a.coordinates.lng !== 0))?.coordinates;
  const known = Boolean(where) && isValidTimeZone(timeZone) && /^\d{4}-\d{2}-\d{2}$/.test(day.date ?? "");
  const sun = known && where && timeZone ? sunTimes(day.date, where.lat, where.lng, timeZone) : ORDINARY;
  const starts = day.activities.map((a) => toMinutes(a.start_time)).filter((m): m is number => m !== null);
  const first = starts.length ? Math.min(...starts) : 540;
  const last = day.activities[day.activities.length - 1];
  const end = (toMinutes(last?.start_time) ?? first) + (last?.duration_minutes ?? 60);
  return { sun, known, stops: skyStops(sun), first, end };
}

/**
 * The plan as a sky: each day is drawn in the light its stops will really have,
 * from the true sunrise and sunset for that place and date, and the night
 * between two days passes as you scroll. The colours are laid down after layout,
 * where each moment of the plan sits on the page.
 */
export default function SkyPlan({
  itinerary,
  dateRange,
  totalCost,
  onEditDates,
  editDatesLabel,
  pace,
  onAskAssistant,
  onShowMap,
}: {
  itinerary: GeneratedItinerary;
  dateRange: string;
  /** The trip's estimate in the viewer's currency. */
  totalCost: string;
  onEditDates?: () => void;
  editDatesLabel: string;
  pace: string;
  onAskAssistant: (message: string) => void;
  onShowMap: () => void;
}) {
  const t = useTranslations("trips");
  const locale = useLocale();
  const { convert, format } = useCurrency();
  const currency = itinerary.trip_summary.currency;
  const skies = useMemo(() => itinerary.days.map((day) => skyOfDay(day, itinerary.timezone)), [itinerary.days, itinerary.timezone]);
  const colorAt = useMemo(
    () =>
      (t: number): Rgb => {
        const index = Math.min(Math.max(Math.floor(t / DAY), 0), skies.length - 1);
        return skyAt(skies[index].stops, t - index * DAY);
      },
    [skies]
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const [sky, setSky] = useState<{ background: string; nights: Array<{ top: number; height: number }> }>(() => ({
    background: toCss(colorAt((skies[0]?.first ?? 540) - 45)),
    nights: [],
  }));

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const draw = () => {
      const height = root.scrollHeight;
      const top = root.getBoundingClientRect().top;
      const anchors = [...root.querySelectorAll<HTMLElement>("[data-t]")].map((node) => ({
        y: node.getBoundingClientRect().top - top,
        t: Number(node.dataset.t),
        node,
      }));
      if (!anchors.length) return;
      const { background, nights, points } = skyGradient(anchors, height, colorAt, PAGE);

      // Each block's words in whichever colour reads on the sky right behind them, top to bottom.
      for (const node of root.querySelectorAll<HTMLElement>("[data-ink]")) {
        const box = node.getBoundingClientRect();
        const samples = [box.top + 4, (box.top + box.bottom) / 2, box.bottom - 4].map((y) => colorAt(timeAtY(points, y - top)));
        node.style.color = toCss(inkFor(samples));
      }

      setSky({ background, nights });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [colorAt]);

  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const distance = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const first = skies[0];
  const lastIndex = itinerary.days.length - 1;

  return (
    <div ref={rootRef} className="relative isolate overflow-hidden text-[#0f2230]" data-testid="sky-plan">
      <div aria-hidden="true" className="absolute inset-0 -z-20" style={{ background: sky.background }} />
      {sky.nights.map((night) => (
        <div key={night.top} aria-hidden="true" className={styles.stars} style={{ top: night.top, height: night.height }} />
      ))}

      <div className="mx-auto max-w-2xl px-5 pb-48 sm:px-8">
        <header data-t={(first?.first ?? 540) - 45} data-ink className="pt-14 sm:pt-20">
          <h1 className="-ml-1 text-[clamp(4.25rem,22vw,8rem)] font-normal leading-[0.92] tracking-[-0.04em]">{itinerary.destination.name}</h1>
          <p className="mt-3 text-xl">{itinerary.destination.country}</p>
          <p className="mt-1 text-lg">
            {onEditDates ? (
              <button
                type="button"
                onClick={onEditDates}
                aria-label={`${editDatesLabel}: ${dateRange}`}
                className="min-h-[44px] font-semibold underline decoration-1 underline-offset-4"
              >
                {dateRange}
              </button>
            ) : (
              dateRange
            )}
            {", "}
            {t("wizard.result.sky.about", { cost: totalCost })}
          </p>
          <nav aria-label={t("wizard.result.sky.days")} className="mt-6 flex flex-wrap gap-2">
            {itinerary.days.map((day) => (
              <a
                key={day.day_number}
                href={`#day-${day.day_number}`}
                className={`${styles.pill} inline-flex min-h-[44px] items-center rounded-full px-4 text-base font-semibold text-[#0f2230]`}
              >
                {t("wizard.result.dayLabel", { n: day.day_number })}
              </a>
            ))}
            <button type="button" onClick={onShowMap} className={`${styles.pill} inline-flex min-h-[44px] items-center rounded-full px-4 text-base font-semibold text-[#0f2230]`}>
              {t("wizard.result.sky.map")}
            </button>
          </nav>
        </header>

        {itinerary.days.map((day, index) => {
          const daySky = skies[index];
          const base = index * DAY;
          const { sunrise, sunset } = daySky.sun;
          const date = /^\d{4}-\d{2}-\d{2}$/.test(day.date ?? "") ? weekday.format(new Date(`${day.date}T12:00:00Z`)) : null;
          return (
            <Fragment key={day.day_number}>
              {index > 0 && <div aria-hidden="true" data-t={base + 30} className="h-36" />}
              <section id={`day-${day.day_number}`} className="scroll-mt-24 pt-12">
                <div data-t={base + daySky.first - 25} data-ink>
                  <p className="text-base font-semibold">{t("wizard.result.dayLabel", { n: day.day_number })}</p>
                  <h2 className="mt-1 text-[2rem] font-medium leading-[1.12] tracking-[-0.012em]">{day.title || day.theme}</h2>
                  <p className="mt-2 text-[1.0625rem] leading-[1.4]">
                    {date && `${date}. `}
                    {daySky.known &&
                      (daySky.sun.polar === "day"
                        ? t("wizard.result.sky.sunUpAllDay")
                        : daySky.sun.polar === "night"
                          ? t("wizard.result.sky.sunDownAllDay")
                          : t("wizard.result.sky.sunLine", { sunrise: clockOf(sunrise ?? 0), sunset: clockOf(sunset ?? 0) }))}
                  </p>
                  {showsDayBudget(day) && (
                    <p className="mt-1 text-[1.0625rem]">
                      {t("wizard.result.dailyBudget")}: {dayBudgetLabel(day, { convert, format }, t("activity.free"), currency)}
                    </p>
                  )}
                  <DayStrip daySky={daySky} day={day} />
                  <div className="mt-2 flex flex-col items-start gap-2">
                    <DayRouteLink activities={day.activities} surface="result" className="text-inherit!" />
                    <PackedDayNote activities={day.activities} pace={pace} onLighten={() => onAskAssistant(lightenDayRequest(day.day_number, day.activities))} />
                  </div>
                </div>

                <ol className={styles.line}>
                  {day.activities.map((activity, i) => {
                    const start = toMinutes(activity.start_time) ?? daySky.first + i * 90;
                    const next = day.activities[i + 1];
                    const nextStart = next ? (toMinutes(next.start_time) ?? start + activity.duration_minutes) : start + activity.duration_minutes;
                    const km = next ? kmBetween(activity.coordinates, next.coordinates) : null;
                    const sunsetHere = daySky.known && sunset !== null && start < sunset && sunset <= nextStart;
                    const sunriseHere = daySky.known && sunrise !== null && start < sunrise && sunrise <= nextStart;
                    return (
                      <Fragment key={`${activity.name}-${i}`}>
                        <SkyStop activity={activity} currency={currency} minutes={base + start} until={base + Math.max(start, Math.min(start + activity.duration_minutes, nextStart))} />
                        {(sunsetHere || sunriseHere) && (
                          <li data-t={base + (sunsetHere ? sunset! : sunrise!)} data-ink className={`${styles.sun} my-3 flex items-center gap-2.5 text-[1.0625rem] font-semibold`}>
                            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                              <circle cx="10" cy="10" r="7" fill="#ffd93d" />
                            </svg>
                            {sunsetHere ? t("wizard.result.sky.sunsetAt", { time: clockOf(sunset!) }) : t("wizard.result.sky.sunriseAt", { time: clockOf(sunrise!) })}
                          </li>
                        )}
                        {km !== null && km >= 0.05 && (
                          <li data-t={base + (Math.min(start + activity.duration_minutes, nextStart) + nextStart) / 2} data-ink className="mb-8 mt-3 text-[0.97rem] opacity-80">
                            {t("wizard.result.sky.toNext", { distance: km < 1 ? `${Math.round(km * 10) * 100} m` : `${distance.format(km)} km` })}
                          </li>
                        )}
                        {km === null && next && <li aria-hidden="true" className="h-6" />}
                      </Fragment>
                    );
                  })}
                </ol>
                {index === lastIndex && (
                  <p data-t={base + Math.max(daySky.end + 60, (sunset ?? 1170) + 120)} data-ink className="mt-16 text-[1.6rem] font-medium leading-[1.16]" style={{ fontFamily: "var(--font-display), Georgia, serif" }}>
                    {t("wizard.result.sky.endOfTrip")}
                  </p>
                )}
              </section>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** The whole day in one bar: the light it passes through, a dot for each stop, the sun going down. */
function DayStrip({ daySky, day }: { daySky: DaySky; day: ItineraryDay }) {
  const from = daySky.first - 20;
  const to = Math.max(daySky.end + 20, from + 300);
  const at = (minutes: number) => `${((minutes - from) / (to - from)) * 100}%`;
  const colors = Array.from({ length: 25 }, (_, i) => {
    const minutes = from + ((to - from) * i) / 24;
    return `${toCss(skyAt(daySky.stops, minutes))} ${(i / 24) * 100}%`;
  });
  const sunset = daySky.known ? daySky.sun.sunset : null;
  return (
    <div className="relative mt-4 h-[34px]" aria-hidden="true">
      <div className="absolute inset-x-0 top-0 h-[18px] rounded-full shadow-[inset_0_0_0_1px_rgba(15,34,48,0.14)]" style={{ background: `linear-gradient(to right, ${colors.join(", ")})` }} />
      {sunset !== null && sunset > from && sunset < to && (
        <span className="absolute top-0.5 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-[#ffd93d] shadow-[0_0_10px_3px_rgba(255,217,61,0.75)]" style={{ left: at(sunset) }} />
      )}
      {day.activities.map((activity, i) => {
        const start = toMinutes(activity.start_time);
        return start === null ? null : (
          <span key={i} className="absolute top-1 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(15,34,48,0.7)]" style={{ left: at(start) }} />
        );
      })}
      <span className="absolute left-0 top-5 text-sm tabular-nums opacity-80">{clockOf(from + 20)}</span>
      <span className="absolute right-0 top-5 text-sm tabular-nums opacity-80">{clockOf(to - 20)}</span>
    </div>
  );
}
