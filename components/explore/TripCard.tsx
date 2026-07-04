import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import type { ExploreTripCard } from "@/lib/explore/types";
import { proxyImageUrl } from "@/lib/img/proxyUrl";

interface TripCardProps {
  trip: ExploreTripCard;
  /**
   * Render variant. Default `grid` for /explore. Use `carousel` for
   * the homepage trending strip (narrower; no description). Use
   * `compact` for the per-destination "trending here" block.
   */
  variant?: "grid" | "carousel" | "compact";
}

/**
 * Trip card rendered in the /explore feed + homepage trending block +
 * per-destination "trending here" block.
 *
 * Click target: the whole card → `/shared/{token}` (the existing
 * anonymous trip view). The TripCard itself is server-rendered; the
 * EngagementBar on the destination page handles like/save/fork — the
 * card just surfaces the counts.
 */
export default function TripCard({ trip, variant = "grid" }: TripCardProps) {
  // i18n: badges, "by {author}", day pluralization, count titles, and the
  // "View →" CTA all shipped in English on /it /es. Keys live alongside
  // PublishToggle + EngagementBar under share.explore.card.
  const t = useTranslations("common.share.explore.card");
  const isCompact = variant === "compact";
  const isCarousel = variant === "carousel";
  const sizes = isCompact
    ? "(max-width: 768px) 50vw, 25vw"
    : "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw";

  // Primary click target: the indexable public trip page. Fall back to the
  // legacy /shared/{token} link when a trip has no public_slug yet (pre-
  // migration / non-public rows).
  const tripHref = trip.publicSlug
    ? `/trip/${trip.publicSlug}`
    : `/shared/${trip.shareToken}`;

  // The byline links to the creator profile when a public username exists.
  // Because the whole card is a link, we use the "stretched link" pattern:
  // the card is a <div>, an absolutely-positioned overlay <Link> covers it
  // for the trip target, and the byline <Link> sits above it (relative z-10)
  // so it captures its own clicks — avoiding invalid nested <a> tags.
  const authorUsername = trip.author.username;

  return (
    <div
      className="group relative rounded-2xl overflow-hidden bg-white border border-slate-200 hover:border-[var(--primary)]/40 hover:shadow-xl transition-all"
      data-testid="explore-trip-card"
    >
      {/* Stretched primary link — covers the whole card, sits beneath the
          interactive byline link. */}
      <Link
        href={tripHref}
        className="absolute inset-0 z-[1]"
        aria-label={trip.title}
      />

      {/* Cover image */}
      <div
        className={`relative ${isCompact ? "h-36" : isCarousel ? "h-44" : "h-48"} overflow-hidden bg-gradient-to-br from-[var(--primary)]/15 to-[var(--accent)]/15`}
      >
        {trip.coverImage ? (
          <Image
            // Pexels CDN intermittently 504s direct browser loads
            // (Cloudflare anti-scraping). Route through same-origin
            // proxy so the bytes come back via our Vercel egress.
            src={proxyImageUrl(trip.coverImage) || trip.coverImage}
            alt={trip.title}
            fill
            sizes={sizes}
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            // Public, frequently-cached. unoptimized for Google Places
            // URLs (Next image optimizer can't always hit them).
            unoptimized={trip.coverImage.includes("googleapis.com")}
          />
        ) : null}
        {/* Top-left badge stack — Editor's Pick + Backpacker. Both
            optional; render whatever applies. Visual hierarchy: Editor's
            Pick sits on top (rarer, higher signal), Backpacker below. */}
        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {trip.isEditorsPick && (
            <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--accent)] text-slate-900 text-xs font-bold shadow-md">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              {t("editorsPick")}
            </div>
          )}
          {trip.travelStyle === "backpacker" && (
            <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-xs font-bold shadow-md">
              <span aria-hidden>🎒</span>
              {t("backpackerBadge")}
            </div>
          )}
        </div>
        {/* Budget pill */}
        <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-sm text-white text-xs font-medium">
          {trip.budgetTier === "budget" ? "$" : trip.budgetTier === "premium" ? "$$$" : "$$"}
        </div>
      </div>

      {/* Body */}
      <div className={isCompact ? "p-3" : "p-5"}>
        <h3
          className={`font-semibold text-slate-900 mb-1 group-hover:text-[var(--primary)] transition-colors line-clamp-1 ${
            isCompact ? "text-base" : "text-lg"
          }`}
        >
          {trip.title}
        </h3>

        {trip.authorNote && !isCompact && (
          <p className="text-sm text-slate-600 mb-3 line-clamp-2 italic">
            “{trip.authorNote}”
          </p>
        )}

        {/* Author + duration */}
        <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
          <span className="truncate">
            {t("byAuthor")}{" "}
            {authorUsername ? (
              <Link
                href={`/creator/${authorUsername}`}
                className="relative z-10 font-medium text-slate-700 hover:text-[var(--primary)] hover:underline"
              >
                {trip.author.displayName}
              </Link>
            ) : (
              <span className="font-medium text-slate-700">
                {trip.author.displayName}
              </span>
            )}
          </span>
          <span className="flex-shrink-0 ml-2">
            {t("days", { count: trip.durationDays })}
          </span>
        </div>

        {/* Engagement counts */}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1" title={t("likesTitle")}>
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
                clipRule="evenodd"
              />
            </svg>
            {trip.likeCount}
          </span>
          <span className="inline-flex items-center gap-1" title={t("savesTitle")}>
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
            </svg>
            {trip.saveCount}
          </span>
          <span className="inline-flex items-center gap-1" title={t("forksTitle")}>
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M9 3v4a3 3 0 003 3h0a3 3 0 003-3V3M9 21v-4a3 3 0 013-3h0a3 3 0 013 3v4M5 7h0a3 3 0 013 3v4a3 3 0 003 3h0M19 7h0a3 3 0 00-3 3v4a3 3 0 01-3 3h0"
                stroke="currentColor"
                strokeWidth="0"
              />
              <circle cx="6" cy="5" r="2" />
              <circle cx="18" cy="5" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
            {trip.forkCount}
          </span>
          {!isCompact && (
            <span className="ml-auto text-[var(--primary)] font-medium group-hover:underline">
              {t("viewAction")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
