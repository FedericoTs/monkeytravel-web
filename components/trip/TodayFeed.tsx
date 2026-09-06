"use client";

/**
 * The Today activity feed — Live Trip Phase 3.5.
 *
 * "Ana is going · Marco skipped lunch · Bob paid €12 · dinner" — a small,
 * chronological stream of what everyone on the trip is doing: participant
 * joins, the four chip actions (3.3), and expenses (3.4), merged server-side
 * (lib/feed/snapshot) and localized here so it reads in the viewer's language.
 * This is the part that makes N people re-open a live trip.
 */
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { centsToAmount } from "@/lib/expenses/shared";
import { describeFeedEvent, feedIcon, relativeTime, type FeedEvent } from "@/lib/feed/shared";

interface TodayFeedProps {
  events: FeedEvent[];
  /** How many rows to show. The route caps the payload higher, for headroom. */
  max?: number;
  className?: string;
}

export default function TodayFeed({ events, max = 6, className = "" }: TodayFeedProps) {
  const t = useTranslations("common");
  const locale = useLocale();

  const rtf = useMemo(() => {
    try {
      return new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    } catch {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    }
  }, [locale]);

  const money = useMemo(
    () => (cents: number, currency: string) => {
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency }).format(centsToAmount(cents));
      } catch {
        return `${centsToAmount(cents).toFixed(2)} ${currency}`;
      }
    },
    [locale],
  );

  const rows = useMemo(() => {
    const now = new Date();
    return events.slice(0, max).map((e) => {
      const d = describeFeedEvent(e);
      const who =
        d.who.kind === "name" ? d.who.name ?? t("today.someone") : d.who.kind === "owner" ? t("today.owner") : t("today.someone");
      const params: Record<string, string | number> = {
        activity: d.params.activity ?? t("today.someActivity"),
        minutes: d.params.minutes ?? 0,
        to: d.params.to ?? "",
      };
      if (typeof d.amountCents === "number") params.amount = money(d.amountCents, d.currency ?? "EUR");
      const what = t(`today.feed.${d.key}`, params);
      const rel = relativeTime(e.at, now);
      const when = rel.unit === "now" ? t("today.feed.justNow") : rtf.format(-rel.value, rel.unit as Intl.RelativeTimeFormatUnit);
      return { id: e.id, icon: feedIcon(e.kind), who, what, when };
    });
  }, [events, max, t, money, rtf]);

  if (rows.length === 0) return null;

  return (
    <section data-testid="today-feed" className={`rounded-2xl border border-slate-200 bg-white p-4 ${className}`} aria-label={t("today.feed.title")}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
        <span aria-hidden>📣</span>
        {t("today.feed.title")}
      </h3>
      <ul className="space-y-1.5" data-testid="today-feed-list">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline gap-2 text-sm text-slate-700">
            <span aria-hidden className="shrink-0">{r.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-slate-900">{r.who}</span> {r.what}
            </span>
            <span className="shrink-0 text-xs text-slate-400 tabular-nums">{r.when}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
