import Image from "next/image";
import { Link } from "@/lib/i18n/routing";
import type { Destination, Locale } from "@/lib/destinations/types";

interface DestinationFeaturedProps {
  destination: Destination;
  locale: Locale;
  eyebrowLabel: string;
  ctaLabel: string;
  daysLabel: string;
  description?: string;
}

/**
 * Magazine-style 'Featured destination' hero card. Full-bleed image on
 * the left (or top on mobile), oversized name + country + intro on the
 * right. Used at the top of /destinations.
 */
export default function DestinationFeatured({
  destination,
  locale,
  eyebrowLabel,
  ctaLabel,
  daysLabel,
  description,
}: DestinationFeaturedProps) {
  const cityName = destination.name[locale];
  const countryName = destination.country[locale];
  const intro = description ?? destination.content.description[locale];

  return (
    <Link
      href={`/destinations/${destination.slug}`}
      className="group block rounded-3xl overflow-hidden bg-white border border-slate-200/80 hover:border-[var(--accent)]/40 hover:shadow-2xl transition-all"
    >
      <div className="grid md:grid-cols-2">
        <div className="relative aspect-[16/10] md:aspect-auto md:min-h-[420px] overflow-hidden">
          <Image
            src={`/images/destinations/${destination.slug}.jpg`}
            alt={cityName}
            fill
            unoptimized
            sizes="(max-width: 768px) 100vw, 50vw"
            priority
            className="object-cover group-hover:scale-105 transition-transform duration-700"
          />
          <div className="md:hidden absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <span className="absolute top-5 left-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-slate-900 text-xs font-bold uppercase tracking-wider shadow-lg">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {eyebrowLabel}
          </span>
        </div>

        <div className="p-7 md:p-10 lg:p-12 flex flex-col justify-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--primary)] mb-3">
            {countryName}
            <span className="mx-2 text-slate-300">·</span>
            <span className="text-slate-500">{daysLabel}</span>
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 mb-4 leading-tight tracking-tight group-hover:text-[var(--primary)] transition-colors">
            {cityName}
          </h2>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed mb-6 line-clamp-3">
            {intro}
          </p>
          <span className="inline-flex items-center gap-1.5 text-[var(--primary)] font-semibold text-sm group-hover:gap-2.5 transition-all">
            {ctaLabel}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}
