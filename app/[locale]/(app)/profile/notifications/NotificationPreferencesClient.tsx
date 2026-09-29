"use client";

/**
 * Notification preferences UI.
 *
 * Reads the current users.notification_settings via /api/profile, applies
 * the user's toggles, and writes back via PATCH /api/profile. The merge
 * happens client-side because /api/profile replaces the whole JSON object
 * — we always send the full settings.
 *
 * The switches are EMAIL_PREFERENCES (lib/email/preferences.ts): the ones
 * the email pipeline actually reads. Every string comes from
 * profile.notificationSettings, in the page's language: this is where the
 * "Manage preferences" link of every email lands.
 *
 * Also shows the last 20 entries from email_log so the user can see what
 * we've actually tried to send them (useful for debugging "where's my
 * invite email?" and for trust — they can see we're not spamming).
 */

import { useEffect, useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import { EMAIL_PREFERENCES, type EmailPreferenceKey } from "@/lib/email/preferences";

type NotificationSettings = Partial<Record<EmailPreferenceKey, boolean>> &
  Record<string, unknown>;

interface EmailLogEntry {
  id: string;
  recipient_email: string;
  template_id: string;
  status: string;
  sent_at: string | null;
  bounced_at: string | null;
  created_at: string;
}

// Applied when a key is missing from the stored settings: the signup
// defaults (app/auth/callback/route.ts), and what the pipeline does with a
// missing key — only an explicit false opts out.
const DEFAULTS: Record<EmailPreferenceKey, boolean> = {
  emailNotifications: true,
  tripReminders: true,
  collabVotes: true,
  marketingNotifications: true,
};

const STATUS_COLOR: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-700",
  queued: "bg-amber-100 text-amber-700",
  skipped_no_key: "bg-slate-100 text-slate-600",
  skipped_disabled: "bg-slate-100 text-slate-600",
  skipped_suppressed: "bg-orange-100 text-orange-700",
  skipped_duplicate: "bg-slate-100 text-slate-500",
  failed: "bg-red-100 text-red-700",
  bounced: "bg-red-100 text-red-700",
  complained: "bg-red-100 text-red-700",
};

// Template ids with a name in profile.notificationSettings.activity.template.
// Anything else (retired or unknown ids) shows as "Email".
const NAMED_TEMPLATES = new Set([
  "invite",
  "vote_cast",
  "trip_reminder",
  "trip_day_digest",
  "trip_followup",
  "feedback_outreach",
  "share_fix_notice",
  "stranded_recovery",
]);

export default function NotificationPreferencesClient() {
  const t = useTranslations("profile.notificationSettings");
  const locale = useLocale();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [emailLog, setEmailLog] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
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

  const isOn = (from: NotificationSettings | null, key: EmailPreferenceKey) => {
    const stored = from?.[key];
    return typeof stored === "boolean" ? stored : DEFAULTS[key];
  };

  const toggle = (key: EmailPreferenceKey) => {
    setSettings((prev) => ({ ...(prev ?? {}), [key]: !isOn(prev, key) }));
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notification_settings: settings }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (err) {
      // The server's own message is English and technical; the user gets
      // the translated one.
      console.error("[notifications] save failed", err);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const formatWhen = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso)
    );

  const masterOn = isOn(settings, "emailNotifications");

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <div className="text-sm text-slate-500 mb-6">
          <Link href="/profile" className="hover:text-slate-700">
            {t("breadcrumbProfile")}
          </Link>
          <span className="mx-2">›</span>
          <span className="text-slate-700">{t("breadcrumbCurrent")}</span>
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">{t("title")}</h1>
        <p className="text-slate-600 mb-8">{t("intro")}</p>

        {loading ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center text-slate-500">
            {t("loading")}
          </div>
        ) : (
          <>
            {/* Preference toggles */}
            <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
              {EMAIL_PREFERENCES.map(({ key, kind }) => {
                const value = isOn(settings, key);
                const isDisabled = kind !== "master" && !masterOn;
                const label = t(`toggles.${key}.label`);
                return (
                  <div
                    key={key}
                    className={`px-5 sm:px-6 py-4 flex items-start gap-4 ${
                      isDisabled ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{label}</p>
                        {kind === "marketing" && (
                          <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                            {t("badgeMarketing")}
                          </span>
                        )}
                        {kind === "master" && (
                          <span className="text-[10px] uppercase tracking-wide bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                            {t("badgeMaster")}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mt-1">
                        {t(`toggles.${key}.description`)}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={value}
                      aria-label={label}
                      onClick={() => !isDisabled && toggle(key)}
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
                {saving ? t("saving") : t("save")}
              </button>
              {savedFlash && (
                <span className="text-sm text-emerald-700 font-medium">
                  ✓ {t("saved")}
                </span>
              )}
              {saveFailed && (
                <span className="text-sm text-red-600">{t("saveFailed")}</span>
              )}
            </div>

            {/* Email history */}
            <h2 className="text-xl font-bold text-slate-900 mt-12 mb-3">
              {t("activity.title")}
            </h2>
            <p className="text-sm text-slate-600 mb-4">{t("activity.intro")}</p>
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {emailLog.length === 0 ? (
                <div className="px-6 py-10 text-center text-slate-500 text-sm">
                  {t("activity.empty")}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {emailLog.map((entry) => {
                    const statusKnown = entry.status in STATUS_COLOR;
                    const statusLabel = statusKnown
                      ? t(`activity.status.${entry.status}`)
                      : entry.status;
                    const statusColor =
                      STATUS_COLOR[entry.status] ?? "bg-slate-100 text-slate-600";
                    const template = NAMED_TEMPLATES.has(entry.template_id)
                      ? t(`activity.template.${entry.template_id}`)
                      : t("activity.template.other");
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
                            {formatWhen(entry.created_at)}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${statusColor}`}
                        >
                          {statusLabel}
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
