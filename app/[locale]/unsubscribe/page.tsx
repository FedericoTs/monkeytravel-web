import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { UNSUB_KEYS, verifyUnsubscribeToken, type UnsubKey } from "@/lib/email/unsubscribe";
import { Link } from "@/lib/i18n/routing";
import { UnsubscribeConfirmButton } from "./UnsubscribeConfirmButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profile.unsubscribe" });
  return {
    // Strip brand suffix — root layout's title.template adds it.
    title: t("metaTitle"),
    description: t("metaDescription"),
    robots: { index: false, follow: false },
  };
}

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

/**
 * Unsubscribe confirmation page.
 *
 * READ-ONLY on render. The actual unsubscribe applies when the user
 * clicks the Confirm button (which POSTs to /api/unsubscribe). This is
 * a deliberate change from the previous flow, which silently flipped
 * the preference on every GET — that meant every Gmail link prefetch,
 * Outlook Safe Links rewrite, Slack unfurl, and antivirus scanner was
 * silently unsubscribing the user before they had a chance to click.
 *
 * If the token is malformed/expired/tampered, we show a friendly
 * explanation + a link to sign in and manage preferences directly.
 */
export default async function UnsubscribePage({ params, searchParams }: PageProps) {
  const [{ locale }, { token }] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale, namespace: "profile.unsubscribe" });
  const result = verifyUnsubscribeToken(token || "");

  // Every UnsubKey has a phrase in profile.unsubscribe.what, shaped to fit
  // "Stop receiving {what}?" in each language (checked by
  // notification-settings-i18n.vitest.ts).
  const key = result.payload?.k;
  const what =
    typeof key === "string" && key in UNSUB_KEYS
      ? t(`what.${key as UnsubKey}`)
      : t("what.fallback");

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
        {result.ok && result.payload ? (
          <UnsubscribeConfirmButton token={token || ""} what={what} />
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              {result.reason === "expired" ? t("expiredTitle") : t("invalidTitle")}
            </h1>
            <p className="text-slate-600 mb-6">
              {result.reason === "expired" ? t("expiredBody") : t("invalidBody")}
            </p>
            <Link
              href="/profile/notifications"
              className="inline-block px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary)]/90"
            >
              {t("openSettings")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
