import { getTranslations } from "next-intl/server";
import { getPublicStats } from "@/lib/stats/public-stats";
import { pickLiveStats, type StatsFocus } from "@/lib/stats/live-stats";

/**
 * The planner pages' figures: real counts from planning sessions, read when
 * the page is built (lib/stats/public-stats.ts), in place of a bar of fixed
 * claims. Renders nothing with fewer than three figures to show.
 */
export default async function LiveStats({ locale, focus }: { locale: string; focus?: StatsFocus }) {
  const stats = await getPublicStats();
  const items = stats ? pickLiveStats(stats, focus) : [];
  if (items.length < 3) return null;

  const t = await getTranslations({ locale, namespace: "common.liveStats" });
  const number = new Intl.NumberFormat(locale);
  // Hairlines come from the gap over a tinted ground, so no cell may be left empty.
  const columns = items.length === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-3";

  return (
    <section aria-labelledby="live-stats-title" className="bg-white border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <p
          id="live-stats-title"
          className="flex items-center justify-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.2em] text-[var(--foreground-muted)]"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
          {t("title")}
        </p>
        <dl
          className={`mt-6 grid ${columns} gap-px overflow-hidden rounded-2xl bg-[var(--foreground)]/10 ring-1 ring-[var(--foreground)]/10`}
        >
          {items.map((item) => (
            <div key={item.key} className="flex flex-col-reverse justify-end bg-white px-5 py-6 sm:px-8 sm:py-8">
              <dt className="mt-3 text-[11px] sm:text-xs font-semibold uppercase leading-snug tracking-[0.14em] text-[var(--foreground-muted)]">
                {t(`items.${item.key}`)}
              </dt>
              <dd className="font-[family-name:var(--font-display)] text-4xl sm:text-5xl font-medium leading-none tracking-tight text-[var(--foreground)] [font-variant-numeric:tabular-nums]">
                {number.format(item.value)}
                <span
                  className={`${item.unit === "s" ? "ml-1.5" : "ml-0.5"} text-2xl sm:text-3xl font-normal text-[var(--foreground-muted)]`}
                >
                  {item.unit === "s" ? t("seconds") : "+"}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-center text-xs text-[var(--foreground-muted)]">{t("caption")}</p>
      </div>
    </section>
  );
}
