import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  UNSUB_KEYS,
  verifyParticipantUnsubscribeToken,
  verifyUnsubscribeToken,
  type UnsubKey,
} from "@/lib/email/unsubscribe";
import { guestDigestTripName } from "@/lib/participants/digest-unsubscribe";
import { createAdminClient } from "@/lib/supabase/admin";
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
  // A guest's link stops one trip's daily plan. An expired one is reported as
  // expired, not checked again as an account's link.
  const guest = verifyParticipantUnsubscribeToken(token || "");
  const result = guest.ok || guest.reason === "expired" ? null : verifyUnsubscribeToken(token || "");
  const expired = (result ?? guest).reason === "expired";

  let confirm: ReactNode = null;
  if (guest.ok && guest.participantId) {
    let trip: string | null = null;
    try {
      trip = await guestDigestTripName(createAdminClient(), guest.participantId);
    } catch {
      // Only the copy needs the name: without it the page says "this trip".
    }
    const what = trip ? t("guest.what", { trip }) : t("guest.whatThisTrip");
    confirm = <UnsubscribeConfirmButton token={token || ""} what={what} guest />;
  } else if (result?.ok && result.payload) {
    // Every UnsubKey has a phrase in profile.unsubscribe.what, shaped to fit
    // "Stop receiving {what}?" in each language (checked by
    // notification-settings-i18n.vitest.ts).
    const key = result.payload.k;
    const what =
      typeof key === "string" && key in UNSUB_KEYS
        ? t(`what.${key as UnsubKey}`)
        : t("what.fallback");
    confirm = <UnsubscribeConfirmButton token={token || ""} what={what} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
        {confirm ?? (
          <>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              {expired ? t("expiredTitle") : t("invalidTitle")}
            </h1>
            <p className="text-slate-600 mb-6">
              {expired ? t("expiredBody") : t("invalidBody")}
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
