import Image from "next/image";
import { Link } from "@/lib/i18n/routing";
import type { Destination, Locale } from "@/lib/destinations/types";

interface DestinationCardProps {
  destination: Destination;
  locale: Locale;
  planTripLabel: string;
  daysLabel: string;
  tagLabels: Record<string, string>;
}

export default function DestinationCard({
  destination,
  locale,
  planTripLabel,
  daysLabel,
  tagLabels,
}: DestinationCardProps) {
  const { slug, name, country, countryCode, stats, tags } = destination;

  return (
    <Link
      href={`/destinations/${slug}`}
      className="group block rounded-2xl overflow-hidden bg-white border border-gray-100 hover:border-[var(--accent)]/30 hover:shadow-xl transition-all"
    >
      {/* Image */}
      <div className="relative h-48 overflow-hidden bg-gradient-to-br from-[var(--primary)]/20 to-[var(--accent)]/20">
        <Image
          src={`/images/destinations/${slug}.jpg`}
          alt={name[locale]}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          loading="lazy"
        />
        {/* Budget badge */}
        <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-sm text-white text-xs font-medium">
          {"$".repeat(stats.budgetLevel)}
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Image
            src={`https://flagcdn.com/16x12/${countryCode.toLowerCase()}.png`}
            alt={country[locale]}
            width={16}
            height={12}
            className="rounded-sm"
          />
          <span className="text-xs text-[var(--foreground-muted)]">
            {country[locale]}
          </span>
        </div>

        <h3 className="text-xl font-bold text-[var(--foreground)] mb-2 group-hover:text-[var(--primary)] transition-colors">
          {name[locale]}
        </h3>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs rounded-full bg-[var(--primary)]/5 text-[var(--primary)] font-medium"
            >
              {tagLabels[tag] ?? tag}
            </span>
          ))}
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between text-sm text-[var(--foreground-muted)]">
          <span>{daysLabel}</span>
          <span className="text-[var(--primary)] font-semibold group-hover:underline">
            {planTripLabel} →
          </span>
        </div>
      </div>
    </Link>
  );
}
