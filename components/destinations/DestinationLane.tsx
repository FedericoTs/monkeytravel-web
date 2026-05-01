import { Link } from "@/lib/i18n/routing";
import type { Destination, Locale } from "@/lib/destinations/types";
import DestinationGrid from "./DestinationGrid";

interface DestinationLaneProps {
  title: string;
  description?: string;
  destinations: Destination[];
  locale: Locale;
  planTripLabel: string;
  daysLabel: (days: number) => string;
  tagLabels: Record<string, string>;
  viewAllHref?: string;
  viewAllLabel?: string;
}

/**
 * Curated lane on /destinations. Title + (optional view-all) + 3-col
 * DestinationGrid. Renders nothing when destinations is empty.
 */
export default function DestinationLane({
  title,
  description,
  destinations,
  locale,
  planTripLabel,
  daysLabel,
  tagLabels,
  viewAllHref,
  viewAllLabel,
}: DestinationLaneProps) {
  if (destinations.length === 0) return null;

  return (
    <section className="py-10 sm:py-12">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">{title}</h2>
          {description && (
            <p className="mt-1 text-sm sm:text-base text-slate-500 leading-relaxed">{description}</p>
          )}
        </div>
        {viewAllHref && viewAllLabel && (
          <Link
            href={viewAllHref}
            className="hidden sm:inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[var(--primary)] hover:gap-2.5 transition-all"
          >
            {viewAllLabel}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        )}
      </div>
      <DestinationGrid
        destinations={destinations}
        locale={locale}
        planTripLabel={planTripLabel}
        daysLabel={daysLabel}
        tagLabels={tagLabels}
      />
    </section>
  );
}
