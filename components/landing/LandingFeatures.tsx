import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

export interface LandingFeature {
  key: string;
  /** Background and text classes of the icon tile. */
  color: string;
  icon: ReactNode;
}

const COLUMNS = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" } as const;

/** The features grid: `features.title`, `.subtitle` and `.items.<key>` in the page's namespace. */
export default async function LandingFeatures({
  namespace,
  features,
  columns = 3,
}: {
  namespace: string;
  features: LandingFeature[];
  columns?: keyof typeof COLUMNS;
}) {
  const t = await getTranslations(namespace);
  return (
    <section id="features" className="py-24 bg-white relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-pattern-accent opacity-30" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)]/10 text-[var(--foreground)] text-sm font-semibold mb-6">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
            {t("features.title")}
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
            {t("features.title")}
          </h2>
          <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
            {t("features.subtitle")}
          </p>
        </div>

        <div className={`grid md:grid-cols-2 ${COLUMNS[columns]} gap-6`}>
          {features.map((feature) => (
            <div
              key={feature.key}
              className="group relative p-8 rounded-3xl bg-[var(--background-alt)] border border-gray-100 card-hover"
            >
              <div className={`w-14 h-14 rounded-2xl ${feature.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                {feature.icon}
              </div>
              <h3 className="text-xl font-semibold text-[var(--foreground)] mb-3">
                {t(`features.items.${feature.key}.title`)}
              </h3>
              <p className="text-[var(--foreground-muted)] leading-relaxed">
                {t(`features.items.${feature.key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
