import { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { verifyFeedbackToken } from "@/lib/feedback/token";
import FeedbackLinkExpired from "../FeedbackLinkExpired";
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

  if (!verification.ok) return <FeedbackLinkExpired locale={locale} />;

  return (
    <div className="min-h-screen min-h-dvh bg-[var(--background)] flex items-center justify-center p-4">
      <div className="max-w-lg w-full rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <FeedbackPageForm token={token} />
      </div>
    </div>
  );
}
