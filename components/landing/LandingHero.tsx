import { getTranslations } from "next-intl/server";
import HeroDoodleBackground from "@/components/marketing/HeroDoodleBackground";
import { HERO_DOODLE_ENABLED } from "@/components/marketing/doodle";
import { Link } from "@/lib/i18n/routing";

/** The hero: `hero.*` in the page's namespace, with its call to plan a trip. */
export default async function LandingHero({
  namespace,
  ctaHref = "/trips/new",
  trustSignals = ["free", "noCard", "instant"],
}: {
  namespace: string;
  ctaHref?: string;
  /** Keys under `hero.trustSignals`, shown with a check under the buttons. */
  trustSignals?: readonly string[];
}) {
  const t = await getTranslations(namespace);
  return (
    <section className="relative min-h-[80vh] pt-20 pb-16 overflow-hidden hero-gradient">
      {HERO_DOODLE_ENABLED ? (
        <HeroDoodleBackground layout="centered" />
      ) : (
        <>
          {/* Grid overlay */}
          <div className="absolute inset-0 bg-grid-pattern-light opacity-50" />

          {/* Animated orbs */}
          <div className="absolute top-32 left-[10%] w-72 h-72 bg-[var(--accent)]/10 rounded-full blur-[100px] animate-pulse-glow" />
          <div className="absolute top-64 right-[5%] w-96 h-96 bg-[var(--primary)]/8 rounded-full blur-[120px] animate-pulse-glow" style={{ animationDelay: "2s" }} />
        </>
      )}

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-sm font-semibold text-emerald-700">
            {t("hero.badge")}
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--foreground)] leading-[1.08] tracking-tight mb-6">
          {t("hero.title")}
        </h1>

        <p className="text-lg sm:text-xl text-[var(--foreground-muted)] mb-10 max-w-2xl leading-relaxed">
          {t("hero.subtitle")}
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <Link
            href={ctaHref}
            className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--foreground)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30"
          >
            <span>{t("hero.cta")}</span>
            <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
          <a
            href="#how-it-works"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white border-2 border-gray-200 text-[var(--foreground)] font-semibold rounded-xl hover:border-[var(--primary)] hover:text-[var(--primary-ink)] transition-all"
          >
            {t("hero.secondaryCta")}
          </a>
        </div>

        {/* Trust Signals */}
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-sm text-[var(--foreground-muted)]">
          {trustSignals.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>{t(`hero.trustSignals.${key}`)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
