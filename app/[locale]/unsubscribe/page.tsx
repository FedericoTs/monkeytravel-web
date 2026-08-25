import { verifyUnsubscribeToken, type UnsubKey } from "@/lib/email/unsubscribe";
import { Link } from "@/lib/i18n/routing";
import { UnsubscribeConfirmButton } from "./UnsubscribeConfirmButton";

export const metadata = {
  // Strip brand suffix — root layout's title.template adds it.
  title: "Unsubscribe",
  description: "Manage your email notification preferences.",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

const KEY_LABEL: Record<UnsubKey, string> = {
  all: "all email notifications",
  collabVotes: "vote notifications",
  collabProposals: "activity proposal notifications",
  collabComments: "comment notifications",
  inviteAccepted: "invite-accepted notifications",
  weeklyDigest: "the weekly digest",
  marketingNotifications: "marketing emails",
  // Pre-trip cascade — keyed by the same UnsubKey the email-send
  // orchestrator stamps on the List-Unsubscribe header for
  // TripReminderEmail (lib/email/send.ts UNSUB_KEY).
  tripReminders: "pre-trip reminder emails",
};

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
export default async function UnsubscribePage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  const result = verifyUnsubscribeToken(token || "");

  const what = result.payload?.k
    ? KEY_LABEL[result.payload.k as UnsubKey] ?? "those notifications"
    : "those notifications";

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
        {result.ok && result.payload ? (
          <UnsubscribeConfirmButton token={token || ""} what={what} />
        ) : result.reason === "expired" ? (
          <>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Link expired
            </h1>
            <p className="text-slate-600 mb-6">
              This unsubscribe link expired. You can manage all your
              preferences here:
            </p>
            <Link
              href="/profile/notifications"
              className="inline-block px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary)]/90"
            >
              Notification settings
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Couldn&apos;t verify this link
            </h1>
            <p className="text-slate-600 mb-6">
              The unsubscribe link looks invalid or has been tampered with.
              Sign in to manage your preferences directly:
            </p>
            <Link
              href="/profile/notifications"
              className="inline-block px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary)]/90"
            >
              Open notification settings
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
