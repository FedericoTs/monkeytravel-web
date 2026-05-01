import Image from "next/image";
import { Link } from "@/lib/i18n/routing";
import type { Destination, Locale } from "@/lib/destinations/types";

interface BlogPlanThisCtaProps {
  destination: Destination;
  locale: Locale;
  title: string;       // e.g. "Plan your Bali trip"
  ctaLabel: string;    // e.g. "Start with AI"
  description: string; // e.g. "Drop your dates and we'll build the itinerary in 30 seconds."
}

/**
 * Personalized end-of-article CTA tied to the post's primary destination.
 * Shown only when the post's tags resolved to a real destination via
 * lib/blog/primaryDestination.ts. Acts as the "save this trip / plan it
 * now" primitive — the conversion target is the destination page where
 * the AI planner is one tap away.
 */
export default function BlogPlanThisCta({
  destination,
  locale,
  title,
  ctaLabel,
  description,
}: BlogPlanThisCtaProps) {
  return (
    <section className="my-10 not-prose">
      <Link
        href={`/destinations/${destination.slug}`}
        className="group block rounded-2xl overflow-hidden bg-white border border-slate-200/80 hover:border-[var(--accent)]/40 hover:shadow-xl transition-all"
      >
        <div className="grid md:grid-cols-[200px_1fr]">
          <div className="relative h-40 md:h-full bg-gradient-to-br from-[var(--primary)]/15 to-[var(--accent)]/15 overflow-hidden">
            <Image
              src={`/images/destinations/${destination.slug}.jpg`}
              alt={destination.name[locale]}
              fill
              unoptimized
              className="object-cover group-hover:scale-105 transition-transform duration-500"
              sizes="(max-width: 768px) 100vw, 200px"
              loading="lazy"
            />
          </div>
          <div className="p-5 md:p-6 flex flex-col justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--primary)] mb-1.5">
                {destination.name[locale]} · {destination.country[locale]}
              </p>
              <h3 className="text-lg sm:text-xl font-bold text-slate-900 mb-1.5 leading-tight group-hover:text-[var(--primary)] transition-colors">
                {title}
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--primary)] font-semibold text-sm group-hover:gap-2.5 transition-all">
              <span>{ctaLabel}</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}
