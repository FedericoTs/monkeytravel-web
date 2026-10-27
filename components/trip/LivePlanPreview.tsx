"use client";

import { useTranslations } from "next-intl";
import type { SseDayData, SseOutlineData } from "@/lib/streaming/sse";

type Stop = { time?: string; name: string; place?: string };
type OutlineDay = SseOutlineData["days"][number];

/** What a streamed day can show before the plan is complete. */
function stopsOf(day: SseDayData): Stop[] {
  const activities = Array.isArray(day.activities) ? day.activities : [];
  return activities.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const r = a as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name.trim()) return [];
    return [
      {
        name: r.name,
        ...(typeof r.start_time === "string" ? { time: r.start_time } : {}),
        ...(typeof r.location === "string" && r.location.trim() ? { place: r.location } : {}),
      },
    ];
  });
}

/**
 * The plan as it streams in: each day as soon as the model has written it,
 * then the next one still being planned. A long trip's outline shows every
 * day at once, each filled in as it arrives. Photos, the map and saving come
 * with the finished plan.
 */
export function LivePlanPreview({
  days,
  outline = [],
  totalDays,
}: {
  days: SseDayData[];
  outline?: OutlineDay[];
  totalDays: number;
}) {
  const t = useTranslations("common.generation");
  const next = days.length < totalDays ? days.length + 1 : null;
  const pending = outline.filter((d) => d.day_number > days.length);
  return (
    <ol className="space-y-3" aria-busy={next !== null} aria-label={t("liveTitle")}>
      {days.map((day, i) => {
        const theme = typeof day.theme === "string" ? day.theme : typeof day.title === "string" ? day.title : null;
        return (
          <li
            key={`${day.day_number}-${i}`}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm motion-safe:animate-fade-in-up sm:p-5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t("dayLabel", { n: day.day_number ?? i + 1 })}
            </p>
            {theme && <h3 className="mt-0.5 text-lg font-semibold text-slate-900">{theme}</h3>}
            <ul className="mt-3 space-y-2">
              {stopsOf(day).map((stop, j) => (
                <li key={j} className="flex gap-3 text-sm">
                  <span className="w-12 shrink-0 tabular-nums text-slate-500">{stop.time ?? ""}</span>
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{stop.name}</span>
                    {stop.place && <span className="text-slate-500"> · {stop.place}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
      {pending.length > 0
        ? pending.map((day) => (
            <li
              key={`outline-${day.day_number}`}
              className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4 sm:p-5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t("dayLabel", { n: day.day_number })}
              </p>
              <h3 className="mt-0.5 text-lg font-semibold text-slate-700">{day.theme}</h3>
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-medium">{day.area}</span>
                {day.places.length > 0 && <span className="text-slate-500"> · {day.places.join(", ")}</span>}
              </p>
              {day.day_number === next && (
                <p className="mt-2 text-xs text-slate-500 motion-safe:animate-pulse">{t("planningDay", { n: next })}</p>
              )}
            </li>
          ))
        : next !== null && (
            <li className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4 sm:p-5" aria-hidden="true">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t("dayLabel", { n: next })}
              </p>
              <p className="mt-1 text-sm text-slate-500">{t("planningDay", { n: next })}</p>
              <div className="mt-3 space-y-2 motion-safe:animate-pulse">
                <div className="h-3 w-3/4 rounded bg-slate-200" />
                <div className="h-3 w-1/2 rounded bg-slate-200" />
                <div className="h-3 w-2/3 rounded bg-slate-200" />
              </div>
            </li>
          )}
    </ol>
  );
}
