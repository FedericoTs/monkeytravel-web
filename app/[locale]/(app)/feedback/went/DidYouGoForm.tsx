"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import { WENT_REASONS, type WentAnswer } from "@/lib/feedback/went";

async function saveAnswer(body: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return res.ok && json?.saved === true;
  } catch {
    return false;
  }
}

/**
 * The tap in the email is the answer, so it's saved as this opens. That happens
 * here rather than as the server renders the page, because mail scanners fetch
 * links without running scripts. What goes wrong with the plan is one more tap,
 * and leaving now loses nothing.
 */
export default function DidYouGoForm({ token, answer }: { token: string; answer: WentAnswer }) {
  const t = useTranslations("common.didYouGo");
  const [answerSaved, setAnswerSaved] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void saveAnswer({ token, went: answer }).then(setAnswerSaved);
  }, [token, answer]);

  const retry = () => {
    setAnswerSaved(null);
    void saveAnswer({ token, went: answer }).then(setAnswerSaved);
  };

  const send = async () => {
    setSending(true);
    setSendFailed(false);
    const saved = await saveAnswer({ token, went: answer, went_reason: reason, went_note: note });
    setSending(false);
    setSent(saved);
    setSendFailed(!saved);
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-xl font-bold text-slate-900">{t("thanksTitle")}</h1>
        <p className="text-sm text-slate-600">{t("thanksBody")}</p>
        <Link
          href="/trips/new"
          prefetch={false}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--secondary-ink)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--secondary-ink)]/90"
        >
          {t("nextTrip")}
        </Link>
        <Link href={`/feedback/${token}`} prefetch={false} className="text-sm text-slate-600 underline">
          {t("moreLink")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{t(answer === "yes" ? "yesTitle" : "noTitle")}</h1>

      {answerSaved === false ? (
        <div role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{t("error")}</span>
          <button
            type="button"
            onClick={retry}
            className="min-h-[44px] shrink-0 rounded-xl border border-slate-300 px-4 font-medium text-slate-800 hover:border-slate-400"
          >
            {t("tryAgain")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-600">{t("noted")}</p>
      )}

      <fieldset>
        <legend className="text-sm font-medium text-slate-800">
          {t(answer === "yes" ? "yesQuestion" : "noQuestion")}
        </legend>
        <div className="mt-2 flex flex-col gap-2" role="radiogroup">
          {WENT_REASONS[answer].map((key) => (
            <button
              type="button"
              key={key}
              role="radio"
              aria-checked={reason === key}
              onClick={() => setReason(key)}
              className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                reason === key
                  ? "border-[var(--secondary-ink)] bg-[var(--secondary-ink)]/10 text-slate-900"
                  : "border-slate-300 text-slate-700 hover:border-slate-400"
              }`}
            >
              {t(`reason_${key}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-sm font-medium text-slate-800">{t("noteLabel")}</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-[var(--secondary-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--secondary-ink)] sm:text-sm"
        />
      </label>

      {sendFailed && (
        <p role="alert" className="text-sm text-red-700">
          {t("error")}
        </p>
      )}

      <button
        type="button"
        onClick={() => void send()}
        disabled={sending || (!reason && !note.trim())}
        className="min-h-[44px] w-full rounded-xl bg-[var(--secondary-ink)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--secondary-ink)]/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sending ? t("sending") : t("send")}
      </button>

      <p className="text-xs leading-relaxed text-slate-500">
        {t("disclosure")}{" "}
        <Link href="/privacy" prefetch={false} className="underline hover:text-slate-600">
          {t("privacyPolicy")}
        </Link>
        .
      </p>
    </div>
  );
}
