import { getTranslations } from "next-intl/server";

/**
 * MonkeyTravel against the usual way of planning this kind of trip:
 * `comparison.title`, `.subtitle`, `.otherHeader` (the right-hand column) and
 * `.items.<key>` in the page's namespace, each item with a `label`, a
 * `monkey` cell and an `otherKey` cell.
 */
export default async function LandingComparison({
  namespace,
  keys,
  otherKey,
}: {
  namespace: string;
  keys: readonly string[];
  otherKey: string;
}) {
  const t = await getTranslations(namespace);
  return (
    <section className="py-24 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
            {t("comparison.title")}
          </h2>
          <p className="text-lg text-[var(--foreground-muted)]">
            {t("comparison.subtitle")}
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          {/* Header */}
          <div className="grid grid-cols-3 border-b border-gray-200 bg-[var(--background-alt)] text-sm font-semibold">
            <div className="p-4 text-[var(--foreground-muted)]" />
            <div className="border-l border-gray-200 p-4 text-center text-[var(--primary-ink)]">
              MonkeyTravel
            </div>
            <div className="border-l border-gray-200 p-4 text-center text-[var(--foreground-muted)]">
              {t("comparison.otherHeader")}
            </div>
          </div>

          {/* Rows */}
          {keys.map((key, i) => (
            <div
              key={key}
              className={`grid grid-cols-3 text-sm ${i < keys.length - 1 ? "border-b border-gray-100" : ""}`}
            >
              <div className="p-4 font-medium text-[var(--foreground)]">
                {t(`comparison.items.${key}.label`)}
              </div>
              <div className="flex items-start gap-2 border-l border-gray-100 p-4 text-[var(--foreground)]">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{t(`comparison.items.${key}.monkey`)}</span>
              </div>
              <div className="flex items-start gap-2 border-l border-gray-100 p-4 text-[var(--foreground-muted)]">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                <span>{t(`comparison.items.${key}.${otherKey}`)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
