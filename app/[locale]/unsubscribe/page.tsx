import { verifyUnsubscribeToken, type UnsubKey } from "@/lib/email/unsubscribe";
import { Link } from "@/lib/i18n/routing";

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
};

/**
 * Unsubscribe confirmation page.
 *
 * The actual unsubscribe applies when the user lands here (the GET handler
 * on /api/unsubscribe writes the preference flip — and the same GET
 * happens implicitly via Gmail/Outlook one-click clients). This page
 * just CONFIRMS what was done, in plain language, with a link to fine-
 * tune preferences if they want.
 *
 * If the token is malformed/expired/tampered, we show a friendly
 * explanation + a link to sign in and manage preferences directly.
 */
export default async function UnsubscribePage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  const result = verifyUnsubscribeToken(token || "");

  // Fire-and-forget the unsubscribe by calling the API route server-side
  // — but only if the token is valid. We can't call the route from inside
  // a server component (no in-app HTTP), so we replicate the write here
  // using the admin client. This is the same logic as the GET handler;
  // dedupe is fine because the field is idempotent.
  let applied = false;
  if (result.ok && result.payload) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { unsubKeyToSettingPatch } = await import("@/lib/email/unsubscribe");
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from("users")
        .select("id, notification_settings")
        .eq("id", result.payload.u)
        .maybeSingle();
      if (profile) {
        const current = (profile.notification_settings ?? {}) as Record<
          string,
          unknown
        >;
        await admin
          .from("users")
          .update({
            notification_settings: {
              ...current,
              ...unsubKeyToSettingPatch(result.payload.k),
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", profile.id);
        applied = true;
      }
    } catch (err) {
      console.error("[unsubscribe page] write failed:", err);
    }
  }

  const what = result.payload?.k
    ? KEY_LABEL[result.payload.k as UnsubKey] ?? "those notifications"
    : "those notifications";

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
        {result.ok && applied ? (
          <>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
              <svg
                className="w-8 h-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              You're unsubscribed
            </h1>
            <p className="text-slate-600 mb-6">
              We'll stop sending you {what}. Sorry for the noise.
            </p>
            <p className="text-sm text-slate-500">
              Changed your mind? You can fine-tune your preferences in{" "}
              <Link
                href="/profile/notifications"
                className="text-[var(--primary)] underline"
              >
                notification settings
              </Link>
              .
            </p>
          </>
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
              Couldn't verify this link
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
