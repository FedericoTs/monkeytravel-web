import { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { verifyFeedbackToken } from "@/lib/feedback/token";
import { isWentAnswer } from "@/lib/feedback/went";
import FeedbackLinkExpired from "../FeedbackLinkExpired";
import DidYouGoForm from "./DidYouGoForm";

/**
 * Where the return email's two answers land (/feedback/went?t=<token>&answer=yes).
 * The signed token says who is answering and about which trip, so no session is
 * needed. Token-driven, so never static, and never indexed.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string | string[]; answer?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.didYouGo" });

  return {
    title: t("title"),
    robots: { index: false, follow: false },
  };
}

export default async function DidYouGoPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { t: token, answer } = await searchParams;

  if (typeof token !== "string" || !isWentAnswer(answer) || !verifyFeedbackToken(token).tripId) {
    return <FeedbackLinkExpired locale={locale} />;
  }

  return (
    <div className="min-h-screen min-h-dvh bg-[var(--background)] flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <DidYouGoForm token={token} answer={answer} />
      </div>
    </div>
  );
}
