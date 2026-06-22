import { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { verifyFeedbackToken } from "@/lib/feedback/token";
import FeedbackPageForm from "./FeedbackPageForm";

/**
 * Public, tokenized feedback page reached from an outreach email
 * (/feedback/<token>). Mirrors the in-app FeedbackSurveyModal questions, but
 * rendered as a full page with NO localStorage gating — a one-time, signed
 * link identifies the user via the token (see lib/feedback/token.ts), so no
 * session is required.
 *
 * Token-driven, so never static. robots: noindex/nofollow — these are private
 * one-time links and must never land in a search index.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.feedbackSurvey" });

  return {
    // Root layout's title.template appends " | MonkeyTravel" — page-level
    // titles must NOT include the suffix themselves.
    title: t("title"),
    robots: { index: false, follow: false },
  };
}

export default async function FeedbackTokenPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const verification = verifyFeedbackToken(token);

  if (!verification.ok) {
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

  return (
    <div className="min-h-screen min-h-dvh bg-[var(--background)] flex items-center justify-center p-4">
      <div className="max-w-lg w-full rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <FeedbackPageForm token={token} />
      </div>
    </div>
  );
}
