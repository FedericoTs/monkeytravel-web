import { getTranslations } from "next-intl/server";
import EmailSubscribe from "@/components/EmailSubscribe";
import { Link } from "@/lib/i18n/routing";

const SURFACES = {
  white: "py-24 bg-white",
  alt: "py-24 bg-[var(--background-alt)]",
} as const;

/** The closing call to plan a trip, with the newsletter signup: `cta.*` in the page's namespace. */
export default async function LandingFinalCta({
  namespace,
  subscribeSource,
  ctaHref = "/trips/new",
  surface = "white",
}: {
  namespace: string;
  /** Which page a newsletter signup came from. */
  subscribeSource: string;
  ctaHref?: string;
  surface?: keyof typeof SURFACES;
}) {
  const t = await getTranslations(namespace);
  return (
    <section className={SURFACES[surface]}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-[2.5rem] mesh-gradient p-12 sm:p-16 lg:p-20">
          {/* Grid overlay */}
          <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--accent)]/20 rounded-full blur-[100px]" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-[var(--primary-light)]/20 rounded-full blur-[80px]" />

          <div className="relative text-center">
            {/* Live badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-sm font-semibold text-white/90 mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
              {t("hero.trustSignals.free")}
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 tracking-tight">
              {t("cta.title")}
            </h2>
            <p className="text-lg sm:text-xl text-white/70 mb-10 max-w-2xl mx-auto leading-relaxed">
              {t("cta.subtitle")}
            </p>

            {/* CTA button */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <Link
                href={ctaHref}
                className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--foreground)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all"
              >
                <span>{t("cta.button")}</span>
                <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>

            {/* Newsletter signup */}
            <div className="pt-8 border-t border-white/10 max-w-md mx-auto">
              <p className="text-sm text-white/55 mb-4">
                {t("cta.mobileNotify")}
              </p>
              <EmailSubscribe variant="dark" source={subscribeSource} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
