"use client";

/**
 * Notification preferences UI.
 *
 * Reads the current users.notification_settings via /api/profile, applies
 * the user's toggles, and writes back via PATCH /api/profile. The merge
 * happens client-side because /api/profile replaces the whole JSON object
 * — we always send the full settings.
 *
 * Also shows the last 20 entries from email_log so the user can see what
 * we've actually tried to send them (useful for debugging "where's my
 * invite email?" and for trust — they can see we're not spamming).
 */

import { useEffect, useState, useCallback } from "react";
import { Link } from "@/lib/i18n/routing";

interface NotificationSettings {
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  // Per-category toggles. Defaults applied client-side when missing.
  collabVotes?: boolean;
  collabProposals?: boolean;
  collabComments?: boolean;
  inviteAccepted?: boolean;
  weeklyDigest?: boolean;
  // Pre-existing keys (kept untouched but exposed in preview so the
  // user sees the full state).
  dealAlerts?: boolean;
  tripReminders?: boolean;
  socialNotifications?: boolean;
  marketingNotifications?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
}

interface EmailLogEntry {
  id: string;
  recipient_email: string;
  template_id: string;
  status: string;
  sent_at: string | null;
  bounced_at: string | null;
  created_at: string;
}

// Defaults — applied when the corresponding key is missing from the
// stored settings. Matches the values in app/auth/callback/route.ts and
// the GDPR posture (digest defaults OFF; transactional defaults ON).
const DEFAULTS: Required<
  Pick<
    NotificationSettings,
    | "emailNotifications"
    | "collabVotes"
    | "collabProposals"
    | "collabComments"
    | "inviteAccepted"
    | "weeklyDigest"
  >
> = {
  emailNotifications: true,
  collabVotes: true,
  collabProposals: true,
  collabComments: true,
  inviteAccepted: true,
  weeklyDigest: false,
};

const TOGGLES: Array<{
  key: keyof typeof DEFAULTS;
  label: string;
  description: string;
  category: "master" | "transactional" | "marketing";
}> = [
  {
    key: "emailNotifications",
    label: "Send me emails",
    description:
      "Master switch. Turn off to stop ALL email — even invites and collaboration alerts.",
    category: "master",
  },
  {
    key: "collabVotes",
    label: "Votes on my trips",
    description:
      "Get an email when a collaborator votes love / no / concerns on an activity.",
    category: "transactional",
  },
  {
    key: "collabProposals",
    label: "Proposed activities",
    description:
      "Get an email when a collaborator suggests a new activity for one of your trips.",
    category: "transactional",
  },
  {
    key: "collabComments",
    label: "Comments on activities",
    description:
      "Get an email when a collaborator adds a comment. (Comment feature coming soon.)",
    category: "transactional",
  },
  {
    key: "inviteAccepted",
    label: "Invite accepted",
    description:
      "Get an email when someone you invited joins one of your trips.",
    category: "transactional",
  },
  {
    key: "weeklyDigest",
    label: "Weekly digest",
    description:
      "Optional weekly recap of trip activity, deals, and travel inspiration.",
    category: "marketing",
  },
];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  sent: { label: "Sent", color: "bg-emerald-100 text-emerald-700" },
  queued: { label: "Queued", color: "bg-amber-100 text-amber-700" },
  skipped_no_key: {
    label: "Skipped — email not yet enabled",
    color: "bg-slate-100 text-slate-600",
  },
  skipped_disabled: {
    label: "Skipped — preference off",
    color: "bg-slate-100 text-slate-600",
  },
  skipped_suppressed: {
    label: "Skipped — previous bounce",
    color: "bg-orange-100 text-orange-700",
  },
  skipped_duplicate: {
    label: "Skipped — duplicate",
    color: "bg-slate-100 text-slate-500",
  },
  failed: { label: "Failed", color: "bg-red-100 text-red-700" },
  bounced: { label: "Bounced", color: "bg-red-100 text-red-700" },
  complained: { label: "Marked as spam", color: "bg-red-100 text-red-700" },
};

const TEMPLATE_LABEL: Record<string, string> = {
  invite: "Trip invite",
  vote_cast: "Vote notification",
  comment_added: "Comment",
  weekly_digest: "Weekly digest",
};

export default function NotificationPreferencesClient() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [emailLog, setEmailLog] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRes, logRes] = await Promise.all([
        fetch("/api/profile", { credentials: "include", cache: "no-store" }),
        fetch("/api/notifications/email-log?limit=20", {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      if (profileRes.ok) {
        const profileJson = await profileRes.json();
        const profileData = profileJson?.data ?? profileJson;
        setSettings(
          (profileData?.profile?.notification_settings as NotificationSettings) ||
            {}
        );
      }
      if (logRes.ok) {
        const logJson = await logRes.json();
        const logData = logJson?.data ?? logJson;
        setEmailLog(logData?.entries ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (key: keyof typeof DEFAULTS) => {
    setSettings((prev) => {
      const next = { ...(prev ?? {}) };
      const current = next[key] ?? DEFAULTS[key];
      next[key] = !current;
      return next;
    });
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notification_settings: settings }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Save failed");
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <div className="text-sm text-slate-500 mb-6">
          <Link href="/profile" className="hover:text-slate-700">
            Profile
          </Link>
          <span className="mx-2">›</span>
          <span className="text-slate-700">Notifications</span>
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Notification preferences
        </h1>
        <p className="text-slate-600 mb-8">
          Choose what we email you about. In-app notifications (the bell)
          are always on for collaboration events — only email is opt-out-able.
        </p>

        {loading ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center text-slate-500">
            Loading your preferences…
          </div>
        ) : (
          <>
            {/* Preference toggles */}
            <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
              {TOGGLES.map((t) => {
                const value =
                  settings?.[t.key] ?? DEFAULTS[t.key];
                const isDisabled =
                  t.key !== "emailNotifications" &&
                  (settings?.emailNotifications ?? true) === false;
                return (
                  <div
                    key={t.key}
                    className={`px-5 sm:px-6 py-4 flex items-start gap-4 ${
                      isDisabled ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">
                          {t.label}
                        </p>
                        {t.category === "marketing" && (
                          <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                            Marketing
                          </span>
                        )}
                        {t.category === "master" && (
                          <span className="text-[10px] uppercase tracking-wide bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                            Master switch
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mt-1">
                        {t.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={value}
                      aria-label={t.label}
                      onClick={() => !isDisabled && toggle(t.key)}
                      disabled={isDisabled}
                      className={`shrink-0 mt-1 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        value
                          ? "bg-[var(--primary)]"
                          : "bg-slate-300"
                      } ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          value ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary)]/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save preferences"}
              </button>
              {savedFlash && (
                <span className="text-sm text-emerald-700 font-medium">
                  ✓ Saved
                </span>
              )}
              {saveError && (
                <span className="text-sm text-red-600">{saveError}</span>
              )}
            </div>

            {/* Email history */}
            <h2 className="text-xl font-bold text-slate-900 mt-12 mb-3">
              Recent email activity
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              The last 20 emails we've tried to send you. "Skipped" means we
              respected a preference or that email isn't enabled yet.
            </p>
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {emailLog.length === 0 ? (
                <div className="px-6 py-10 text-center text-slate-500 text-sm">
                  No emails yet.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {emailLog.map((entry) => {
                    const status = STATUS_LABEL[entry.status] ?? {
                      label: entry.status,
                      color: "bg-slate-100 text-slate-600",
                    };
                    const template =
                      TEMPLATE_LABEL[entry.template_id] ?? entry.template_id;
                    return (
                      <li
                        key={entry.id}
                        className="px-5 sm:px-6 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-900 text-sm">
                            {template}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(entry.created_at).toLocaleString()}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
