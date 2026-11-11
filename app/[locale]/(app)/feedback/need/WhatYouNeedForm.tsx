"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import type { NeedAnswer } from "@/lib/feedback/need";

async function saveAnswer(body: Record<string, string | boolean>): Promise<boolean> {
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
 * The tap in the reminder is the answer, so it's saved as this opens. That
 * happens here rather than as the server renders the page, because mail
 * scanners fetch links without running scripts. A note, and a yes to being
 * written to about it, are one more tap, and leaving now loses nothing.
 */
export default function WhatYouNeedForm({
  token,
  need,
  answerLabel,
}: {
  token: string;
  need: NeedAnswer;
  /** The answer in the words the email used. */
  answerLabel: string;
}) {
  const t = useTranslations("common.whatYouNeed");
  const [answerSaved, setAnswerSaved] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [note, setNote] = useState("");
  const [writeBack, setWriteBack] = useState(false);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void saveAnswer({ token, need }).then(setAnswerSaved);
  }, [token, need]);

  const retry = () => {
    setAnswerSaved(null);
    void saveAnswer({ token, need }).then(setAnswerSaved);
  };

  const send = async () => {
    setSending(true);
    setSendFailed(false);
    const saved = await saveAnswer({ token, need, need_note: note, open_to_chat: writeBack });
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
          href="/trips"
          prefetch={false}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--secondary-ink)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--secondary-ink)]/90"
        >
          {t("yourTrips")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">{t("heading")}</h1>
      <p className="rounded-xl border border-[var(--secondary-ink)] bg-[var(--secondary-ink)]/10 px-3 py-2 text-sm font-semibold text-slate-900">
        {answerLabel}
      </p>

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

      <label className="block">
        <span className="text-sm font-medium text-slate-800">{t("noteLabel")}</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={500}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-[var(--secondary-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--secondary-ink)] sm:text-sm"
        />
      </label>

      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-slate-800">
        <input
          type="checkbox"
          checked={writeBack}
          onChange={(event) => setWriteBack(event.target.checked)}
          className="h-5 w-5 shrink-0 rounded border-slate-300 accent-[var(--secondary-ink)]"
        />
        <span>{t("writeBack")}</span>
      </label>

      {sendFailed && (
        <p role="alert" className="text-sm text-red-700">
          {t("error")}
        </p>
      )}

      <button
        type="button"
        onClick={() => void send()}
        disabled={sending || (!note.trim() && !writeBack)}
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
