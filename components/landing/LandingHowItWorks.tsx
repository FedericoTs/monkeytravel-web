import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

export interface LandingStep {
  key: string;
  icon: ReactNode;
}

/** The numbered steps: `howItWorks.title` and `.steps.<key>` in the page's namespace. */
export default async function LandingHowItWorks({ namespace, steps }: { namespace: string; steps: LandingStep[] }) {
  const t = await getTranslations(namespace);
  return (
    <section id="how-it-works" className="py-24 bg-[var(--background-alt)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--foreground)] text-sm font-semibold mb-6">
            {t("howItWorks.title")}
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
            {t("howItWorks.title")}
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {steps.map((step, index) => (
            <div key={step.key} className="relative text-center">
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-12 left-[60%] w-full h-0.5 bg-gradient-to-r from-[var(--accent)] to-transparent" />
              )}

              {/* Step icon */}
              <div className="relative inline-flex items-center justify-center w-24 h-24 mb-8">
                <div className="absolute inset-0 bg-[var(--accent)]/10 rounded-3xl rotate-6" />
                <div className="absolute inset-0 bg-white rounded-3xl shadow-lg border border-gray-100" />
                <div className="relative text-[var(--primary-ink)]">
                  {step.icon}
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--foreground)] font-bold text-sm flex items-center justify-center shadow-lg">
                  {index + 1}
                </div>
              </div>

              <h3 className="text-xl font-bold text-[var(--foreground)] mb-3">
                {t(`howItWorks.steps.${step.key}.title`)}
              </h3>
              <p className="text-[var(--foreground-muted)] leading-relaxed max-w-xs mx-auto">
                {t(`howItWorks.steps.${step.key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
