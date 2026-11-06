import { getTranslations } from "next-intl/server";

/** What a feedback link shows once it no longer works. */
export default async function FeedbackLinkExpired({ locale }: { locale: string }) {
  const t = await getTranslations("common.feedbackSurvey");

  return (
    <div className="min-h-screen min-h-dvh bg-[var(--background)] flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {t("linkExpiredTitle")}
        </h1>
        <p className="text-slate-600 mb-8">{t("linkExpiredBody")}</p>
        <a
          href={locale === "en" ? "/" : `/${locale}`}
          className="inline-flex items-center justify-center px-6 py-3 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors"
        >
          {t("openApp")}
        </a>
      </div>
    </div>
  );
}
