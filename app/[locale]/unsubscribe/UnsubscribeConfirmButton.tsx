"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";

interface UnsubscribeConfirmButtonProps {
  token: string;
  /**
   * What is being unsubscribed, already in the page's language and shaped to
   * fit "Stop receiving {what}?" (e.g. "trip reminders", "i promemoria di
   * viaggio"). From profile.unsubscribe.what.
   */
  what: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; applied: boolean }
  | { kind: "error"; reason: "generic" | "network" };

/**
 * Client-side Confirm button. POSTs to /api/unsubscribe with the token
 * — only when the user actually clicks. Email scanners (Gmail proxy,
 * Outlook Safe Links, Bitdefender) GET the page silently; they will
 * never trigger the mutation because they don't run JS and don't POST.
 */
export function UnsubscribeConfirmButton({
  token,
  what,
}: UnsubscribeConfirmButtonProps) {
  const t = useTranslations("profile.unsubscribe");
  const [state, setState] = useState<State>({ kind: "idle" });

  const settingsLink = (chunks: ReactNode) => (
    <Link href="/profile/notifications" className="text-[var(--primary-ink)] underline">
      {chunks}
    </Link>
  );

  async function handleClick() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      // The API's own error text is English and technical: show ours.
      if (!res.ok) {
        setState({ kind: "error", reason: "generic" });
        return;
      }
      setState({ kind: "done", applied: Boolean(body?.applied) });
    } catch {
      setState({ kind: "error", reason: "network" });
    }
  }

  if (state.kind === "done") {
    return (
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
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{t("doneTitle")}</h1>
        <p className="text-slate-600 mb-6">{t("doneBody", { what })}</p>
        <p className="text-sm text-slate-500">
          {t.rich("doneChangedMind", { link: settingsLink })}
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        {t("confirmTitle", { what })}
      </h1>
      <p className="text-slate-600 mb-6">{t("confirmBody", { what })}</p>
      <button
        type="button"
        onClick={handleClick}
        disabled={state.kind === "loading"}
        className="inline-block px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary)]/90 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {state.kind === "loading" ? t("confirming") : t("confirm")}
      </button>
      {state.kind === "error" && (
        <p className="mt-4 text-sm text-rose-600">
          {state.reason === "network" ? t("errorNetwork") : t("errorGeneric")}
        </p>
      )}
      <p className="mt-6 text-sm text-slate-500">
        {t.rich("orSettings", { link: settingsLink })}
      </p>
    </>
  );
}
