import type { ComponentProps, ReactNode } from "react";
import type { useTranslations } from "next-intl";
import { ArrowRight, ChevronRight, MapPin, Users } from "lucide-react";
// next-intl Link (not next/link) so hrefs auto-prefix the active locale.
import { Link } from "@/lib/i18n/routing";
import { flagEmoji } from "@/lib/utils/flag-emoji";
import { MOOD_EMOJIS, destinationGradient } from "./visuals";

/**
 * A curated escape's card and the card leading to all of them, for the homepage
 * (rendered on the server) and the trips page (a client carousel). No hooks, so
 * it renders in either; each caller brings its own cover photo.
 */

export interface TemplateTrip {
  id: string;
  title: string;
  description: string;
  destination: string;
  country: string;
  countryCode: string;
  coverImageUrl: string;
  durationDays: number;
  budgetTier: "budget" | "moderate" | "luxury";
  moodTags: string[];
  copyCount: number;
}

export type CuratedEscapesT = ReturnType<typeof useTranslations<"common.curatedEscapes">>;
type CardLinkProps = Pick<ComponentProps<typeof Link>, "prefetch" | "onClick" | "draggable">;

export function TemplateCard({
  template,
  t,
  image,
  coverMissing,
  linkProps,
}: {
  template: TemplateTrip;
  t: CuratedEscapesT;
  /** The cover photo, inside the card's frame. */
  image: ReactNode;
  /** No photo to show: the destination's gradient fills the frame. */
  coverMissing: boolean;
  linkProps?: CardLinkProps;
}) {
  const gradient = destinationGradient(template.destination);
  const budgetLabel =
    template.budgetTier === "budget"
      ? "€"
      : template.budgetTier === "moderate"
      ? "€€"
      : "€€€";

  return (
    <Link
      href={`/trips/template/${template.id}`}
      {...linkProps}
      className="group bg-white rounded-2xl border border-slate-200/80 overflow-hidden hover:shadow-xl transition-all duration-300 hover:border-slate-300 hover:-translate-y-1 block flex-shrink-0 active:scale-[0.98] w-[260px] md:w-[300px]"
    >
      <div
        className="aspect-[4/3] relative overflow-hidden"
        style={{
          background: coverMissing
            ? `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`
            : undefined,
        }}
      >
        {image}

        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        <div className="absolute top-3 left-3 right-3 flex justify-between items-start">
          <span className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/95 backdrop-blur-sm text-slate-700 shadow-sm">
            {t("days", { days: template.durationDays })}
          </span>
          <span className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-400/95 backdrop-blur-sm text-amber-900 shadow-sm">
            {budgetLabel}
          </span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg drop-shadow-md">{flagEmoji(template.countryCode)}</span>
            <span className="text-white/90 text-xs font-medium tracking-wide uppercase">{template.country}</span>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-white drop-shadow-lg leading-tight line-clamp-1">
            {template.destination}
          </h3>
        </div>
      </div>

      <div className="p-4">
        <p className="text-slate-600 text-sm leading-relaxed line-clamp-2 mb-3">
          {template.description}
        </p>

        <div className="flex gap-2 mb-3">
          {template.moodTags.slice(0, 2).map((mood) => {
            const emoji = MOOD_EMOJIS[mood];
            const moodKey = `moods.${mood}` as Parameters<typeof t>[0];
            return (
              <span
                key={mood}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600"
              >
                {emoji} {t(moodKey)}
              </span>
            );
          })}
          {template.moodTags.length > 2 && (
            <span className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-500">
              +{template.moodTags.length - 2}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500 flex items-center gap-1.5">
            {template.copyCount > 0 && (
              <>
                <Users className="w-4 h-4" />
                {t("used", { count: template.copyCount })}
              </>
            )}
          </span>
          <span className="text-[var(--primary-ink)] font-semibold text-sm flex items-center gap-1 group-hover:gap-2 transition-all py-1">
            {t("explore")}
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export function SeeAllCard({ t, linkProps }: { t: CuratedEscapesT; linkProps?: CardLinkProps }) {
  return (
    <Link
      href="/templates"
      {...linkProps}
      className="group flex-shrink-0 w-[200px] md:w-[220px] bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 rounded-2xl overflow-hidden relative flex flex-col items-center justify-center hover:shadow-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
      style={{ aspectRatio: "3/4" }}
    >
      <div className="absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[var(--accent)]" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-white" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center px-4">
        <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          <MapPin className="w-7 h-7 md:w-8 md:h-8 text-white" />
        </div>

        <h3 className="text-white font-bold text-base md:text-lg mb-1">
          {t("exploreAll")}
        </h3>
        <p className="text-white/70 text-xs mb-4">
          {t("moreCuratedTrips")}
        </p>

        <div className="flex items-center gap-2 text-[var(--accent)] font-semibold text-sm group-hover:gap-3 transition-all">
          <span>{t("browse")}</span>
          <ArrowRight className="w-4 h-4" />
        </div>
      </div>
    </Link>
  );
}
