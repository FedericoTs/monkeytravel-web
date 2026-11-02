import { getTranslations } from "next-intl/server";

/**
 * WHAT IS … — one self-contained answer to the page's own category question,
 * sized to the 134-167 word band extraction models favour, so the page can
 * answer a "what is" query (docs/GEO-ANALYSIS.md). The copy lives under
 * `whatIs` in the page's namespace, in all four locales: keep it inside that
 * band when editing.
 */
export default async function LandingWhatIs({ namespace }: { namespace: string }) {
  const t = await getTranslations(namespace);
  return (
    <section className="py-20 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-6">
          {t("whatIs.heading")}
        </h2>
        <div className="space-y-4 text-lg leading-relaxed text-[var(--foreground-muted)]">
          <p>{t("whatIs.definition")}</p>
          <p>{t("whatIs.distinguish")}</p>
          <p>{t("whatIs.product")}</p>
          <p>{t("whatIs.example")}</p>
          <p>{t("whatIs.honest")}</p>
        </div>
      </div>
    </section>
  );
}
