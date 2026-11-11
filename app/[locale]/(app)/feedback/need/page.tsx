import { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { verifyFeedbackToken } from "@/lib/feedback/token";
import { isNeedAnswer } from "@/lib/feedback/need";
import FeedbackLinkExpired from "../FeedbackLinkExpired";
import WhatYouNeedForm from "./WhatYouNeedForm";

/**
 * Where a pre-trip reminder's one question lands
 * (/feedback/need?t=<token>&need=stay&slot=<reminder>). The signed token says
 * who is answering and about which trip, so no session is needed.
 * Token-driven, so never static, and never indexed.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string | string[]; need?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.whatYouNeed" });

  return {
    title: t("title"),
    robots: { index: false, follow: false },
  };
}

export default async function WhatYouNeedPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { t: token, need } = await searchParams;

  if (typeof token !== "string" || !isNeedAnswer(need) || !verifyFeedbackToken(token).tripId) {
    return <FeedbackLinkExpired locale={locale} />;
  }

  // The answer in the words the email used.
  const answers = await getTranslations({ locale, namespace: "common.tripReminderEmail.needAsk" });

  return (
    <div className="min-h-screen min-h-dvh bg-[var(--background)] flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <WhatYouNeedForm token={token} need={need} answerLabel={answers(need)} />
      </div>
    </div>
  );
}
