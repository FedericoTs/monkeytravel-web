import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/routing";
import { proxyImageUrl } from "@/lib/img/proxyUrl";

/**
 * A single published trip belonging to a creator, in the shape the profile
 * grid needs. Deliberately narrow — the profile page maps DB rows into this.
 */
export interface CreatorTripCardData {
  id: string;
  publicSlug: string;
  title: string;
  destination: string;
  coverImage: string | null;
  likeCount: number;
  saveCount: number;
}

export interface CreatorProfileData {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  publicTripCount: number;
  totalLikes: number;
  trips: CreatorTripCardData[];
}

interface CreatorProfileProps {
  creator: CreatorProfileData;
  locale: string;
}

/**
 * Public creator-profile view — the "who made these itineraries" page in the
 * Wanderlog UGC-SEO machine. Server-rendered (no client interactivity needed)
 * so it's fully crawlable. Every trip card deep-links to the indexable
 * `/trip/{public_slug}` page, tightening the internal-link graph.
 *
 * Only public-safe fields reach this component (see the page's allowlist
 * SELECT). It never receives email or payment handles.
 */
export default async function CreatorProfile({
  creator,
  locale,
}: CreatorProfileProps) {
  const t = await getTranslations({ locale, namespace: "common.creator" });
  const name = creator.displayName || t("fallbackName");

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 w-full">
      {/* Breadcrumb */}
      <nav className="text-sm text-slate-500 mb-6" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-slate-700">
          {t("breadcrumbHome")}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900">{name}</span>
      </nav>

      {/* Header — avatar + name + bio + stats */}
      <header className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6 mb-10">
        <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-[var(--primary)]/20 to-[var(--accent)]/20 ring-2 ring-white shadow-md">
          {creator.avatarUrl ? (
            <Image
              src={proxyImageUrl(creator.avatarUrl) || creator.avatarUrl}
              alt={name}
              fill
              sizes="96px"
              className="object-cover"
              unoptimized={creator.avatarUrl.includes("googleapis.com")}
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-[var(--primary)]">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1">
            {name}
          </h1>
          <p className="text-sm text-slate-500 mb-3">@{creator.username}</p>
          {creator.bio && (
            <p className="text-slate-600 text-sm sm:text-base max-w-2xl leading-relaxed mb-3">
              {creator.bio}
            </p>
          )}

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-slate-600">
            <span>
              <strong className="text-slate-900 font-semibold">
                {creator.publicTripCount}
              </strong>{" "}
              {creator.publicTripCount === 1
                ? t("tripsCountSingular")
                : t("tripsCountPlural")}
            </span>
            <span>
              <strong className="text-slate-900 font-semibold">
                {creator.totalLikes}
              </strong>{" "}
              {t("totalLikes")}
            </span>
          </div>
        </div>
      </header>

      {/* Trip grid */}
      <h2 className="sr-only">{t("itinerariesHeading", { name })}</h2>

      {creator.trips.length === 0 ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-10 text-center">
          <p className="text-slate-600">{t("emptyState")}</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {creator.trips.map((trip) => (
            <Link
              key={trip.id}
              href={`/trip/${trip.publicSlug}`}
              className="group block rounded-2xl overflow-hidden bg-white border border-slate-200 hover:border-[var(--primary)]/40 hover:shadow-xl transition-all"
            >
              <div className="relative h-44 overflow-hidden bg-gradient-to-br from-[var(--primary)]/15 to-[var(--accent)]/15">
                {trip.coverImage ? (
                  <Image
                    src={proxyImageUrl(trip.coverImage) || trip.coverImage}
                    alt={trip.title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    unoptimized={trip.coverImage.includes("googleapis.com")}
                  />
                ) : null}
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-slate-900 mb-1 group-hover:text-[var(--primary)] transition-colors line-clamp-1 text-lg">
                  {trip.title}
                </h3>
                <p className="text-xs text-slate-500 mb-3 line-clamp-1">
                  {trip.destination}
                </p>
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
                  <span className="ml-auto text-[var(--primary)] font-medium group-hover:underline">
                    {t("viewAction")}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
