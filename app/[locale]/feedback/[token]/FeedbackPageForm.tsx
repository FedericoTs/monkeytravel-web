"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquareHeart } from "lucide-react";
import { Link } from "@/lib/i18n/routing";

/**
 * Full-page version of the FeedbackSurveyModal form, reached from an outreach
 * email link (/feedback/[token]). Same questions and submit logic as the modal
 * (components/feedback/FeedbackSurveyModal.tsx), page-styled with NO localStorage
 * gating, no open delay, and no BaseModal — the signed `token` identifies the
 * user server-side, so anyone with the link can answer once.
 */

type WouldBook = "yes" | "maybe" | "no" | "";

export default function FeedbackPageForm({ token }: { token: string }) {
  const t = useTranslations("common.feedbackSurvey");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [usesFor, setUsesFor] = useState("");
  const [almostStopped, setAlmostStopped] = useState("");
  const [lastBookedWhere, setLastBookedWhere] = useState("");
  const [wouldBook, setWouldBook] = useState<WouldBook>("");
  const [openToChat, setOpenToChat] = useState(false);
  const [contactEmail, setContactEmail] = useState("");

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "email_link",
          token,
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
        setDone(true);
      } else {
        throw new Error();
      }
    } catch {
      // Any failure (network, !res.ok, or saved !== true): keep every answer
      // intact, surface a retryable error, and re-enable submit.
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

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

  if (done) {
    return (
      <div className="flex flex-col items-center text-center py-4">
        <div className="w-16 h-16 rounded-full bg-[var(--primary)]/10 flex items-center justify-center mb-4">
          <MessageSquareHeart className="w-8 h-8 text-[var(--primary)]" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-1">{t("thanksTitle")}</h2>
        <p className="text-sm text-slate-600 max-w-xs">{t("thanksBody")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-2">
        <h1 className="text-xl font-bold text-slate-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("subtitle")}</p>
      </div>

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

      <div className="pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !hasContent}
          className="w-full bg-[var(--primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? t("sending") : t("send")}
        </button>
      </div>
    </div>
  );
}
