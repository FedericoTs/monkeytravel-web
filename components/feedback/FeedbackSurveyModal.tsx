"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquareHeart } from "lucide-react";
import BaseModal from "@/components/ui/BaseModal";
import { Link } from "@/lib/i18n/routing";

/**
 * Power-user demand-discovery survey (office-hours design doc, 2026-06-21).
 *
 * Shown ONCE to active users (those who have created at least one trip) as a
 * soft prompt, the same gating philosophy as PushOptInSheet. The three
 * questions are the "safeguards" from the design doc: two open-ended (where the
 * surprise lives), the booking/money question (the only real test of the
 * affiliate hypothesis), and a contact opt-in that recruits the real
 * conversation. Answers POST to /api/feedback and land in `user_feedback`.
 *
 * Gating (all client-side, no server roundtrip):
 *   - Parent passes `eligible` (true when the user has >= 1 trip). The parent
 *     already has that data, so no extra query.
 *   - Renders nothing once submitted (`mt_feedback_done`) or recently dismissed
 *     (`mt_feedback_dismissed_at` + 14-day cooldown, future-timestamp-guarded).
 *   - Opens after a 2.5s delay so it never feels like a pop-up trap on landing.
 */
const DONE_KEY = "mt_feedback_done";
const DISMISSED_KEY = "mt_feedback_dismissed_at";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

type WouldBook = "yes" | "maybe" | "no" | "";

function shouldShow(): boolean {
  if (typeof localStorage === "undefined") return false;
  if (localStorage.getItem(DONE_KEY) === "true") return false;
  const dismissedAt = localStorage.getItem(DISMISSED_KEY);
  if (dismissedAt) {
    const elapsed = Date.now() - parseInt(dismissedAt, 10);
    // Guard future-dated timestamps (clock skew / restore) — negative elapsed
    // would otherwise silence the prompt for ~30,000 years.
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < DISMISS_COOLDOWN_MS) {
      return false;
    }
  }
  return true;
}

export default function FeedbackSurveyModal({ eligible }: { eligible: boolean }) {
  const t = useTranslations("common.feedbackSurvey");
  const [isOpen, setIsOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [usesFor, setUsesFor] = useState("");
  const [almostStopped, setAlmostStopped] = useState("");
  const [lastBookedWhere, setLastBookedWhere] = useState("");
  const [wouldBook, setWouldBook] = useState<WouldBook>("");
  const [openToChat, setOpenToChat] = useState(false);
  const [contactEmail, setContactEmail] = useState("");

  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => {
      if (shouldShow()) setIsOpen(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, [eligible]);

  const markDismissed = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    }
    setIsOpen(false);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "in_app",
          uses_for: usesFor.trim() || null,
          almost_stopped: almostStopped.trim() || null,
          last_booked_where: lastBookedWhere.trim() || null,
          would_book_through_us: wouldBook || null,
          open_to_chat: openToChat,
          contact_email: openToChat ? contactEmail.trim() || null : null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.saved === true) {
        // Only mark done when the server confirms the row was saved.
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(DONE_KEY, "true");
        }
        setDone(true);
      } else {
        throw new Error();
      }
    } catch {
      // Any failure (network, !res.ok, or saved !== true): keep every answer
      // intact, surface a retryable error, and never silence the prompt.
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Don't let the user submit a fully empty form — the server drops it anyway
  // (returns saved:false), which would otherwise surface a misleading error.
  const hasContent = Boolean(
    usesFor.trim() ||
      almostStopped.trim() ||
      lastBookedWhere.trim() ||
      wouldBook ||
      (openToChat && contactEmail.trim())
  );

  const inputClass =
    "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={markDismissed}
      usePortal
      maxWidth="max-w-lg"
      animation="slide"
      ariaLabel={t("title")}
      title={done ? undefined : t("title")}
      subtitle={done ? undefined : t("subtitle")}
    >
      {done ? (
        <div className="flex flex-col items-center text-center py-4">
          <div className="w-16 h-16 rounded-full bg-[var(--primary)]/10 flex items-center justify-center mb-4">
            <MessageSquareHeart className="w-8 h-8 text-[var(--primary)]" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">{t("thanksTitle")}</h3>
          <p className="text-sm text-slate-600 mb-6 max-w-xs">{t("thanksBody")}</p>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="w-full bg-[var(--primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors"
          >
            {t("close")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-800">{t("q1Label")}</span>
            <textarea
              value={usesFor}
              onChange={(e) => setUsesFor(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder={t("q1Placeholder")}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-800">{t("q2Label")}</span>
            <textarea
              value={almostStopped}
              onChange={(e) => setAlmostStopped(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder={t("q2Placeholder")}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-800">{t("q3Label")}</span>
            <input
              type="text"
              value={lastBookedWhere}
              onChange={(e) => setLastBookedWhere(e.target.value)}
              className={inputClass}
              placeholder={t("q3Placeholder")}
            />
          </label>

          <fieldset>
            <legend id="feedback-q4-label" className="text-sm font-medium text-slate-800">{t("q4Label")}</legend>
            <div className="flex gap-2 mt-2" role="radiogroup" aria-labelledby="feedback-q4-label">
              {(["yes", "maybe", "no"] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  role="radio"
                  onClick={() => setWouldBook(v)}
                  aria-checked={wouldBook === v}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                    wouldBook === v
                      ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                      : "border-slate-300 text-slate-600 hover:border-slate-400"
                  }`}
                >
                  {t(`q4_${v}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={openToChat}
              onChange={(e) => setOpenToChat(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
            />
            <span className="text-sm text-slate-700">{t("chatLabel")}</span>
          </label>
          {openToChat && (
            <label className="block">
              <span className="text-sm font-medium text-slate-800">{t("emailLabel")}</span>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className={inputClass}
                placeholder={t("emailPlaceholder")}
                autoComplete="email"
              />
            </label>
          )}

          <p className="text-xs text-slate-400 leading-relaxed">
            {t("disclosurePrefix")}{" "}
            <Link href="/privacy" className="underline hover:text-slate-600">
              {t("privacyPolicy")}
            </Link>
            .
          </p>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {t("error")}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={markDismissed}
              disabled={submitting}
              className="flex-1 text-slate-500 hover:text-slate-700 py-3 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {t("notNow")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !hasContent}
              className="flex-1 bg-[var(--primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? t("sending") : t("send")}
            </button>
          </div>
        </div>
      )}
    </BaseModal>
  );
}
