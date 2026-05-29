"use client";

import { useState } from "react";
import { Link } from "@/lib/i18n/routing";

interface UnsubscribeConfirmButtonProps {
  token: string;
  /** Human-readable label for what is being unsubscribed (e.g. "vote notifications"). */
  what: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; applied: boolean }
  | { kind: "error"; message: string };

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
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleClick() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          kind: "error",
          message:
            typeof body?.error === "string"
              ? body.error
              : "We couldn't update your preferences. Please try again.",
        });
        return;
      }
      setState({ kind: "done", applied: Boolean(body?.applied) });
    } catch {
      setState({
        kind: "error",
        message: "Network error. Please try again.",
      });
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
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          You&apos;re unsubscribed
        </h1>
        <p className="text-slate-600 mb-6">
          We&apos;ll stop sending you {what}. Sorry for the noise.
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
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        Unsubscribe from {what}?
      </h1>
      <p className="text-slate-600 mb-6">
        Click confirm and we&apos;ll stop sending you {what}. You can re-enable
        them any time from your notification settings.
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={state.kind === "loading"}
        className="inline-block px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary)]/90 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {state.kind === "loading" ? "Unsubscribing…" : "Confirm unsubscribe"}
      </button>
      {state.kind === "error" && (
        <p className="mt-4 text-sm text-rose-600">{state.message}</p>
      )}
      <p className="mt-6 text-sm text-slate-500">
        Or go straight to{" "}
        <Link
          href="/profile/notifications"
          className="text-[var(--primary)] underline"
        >
          notification settings
        </Link>{" "}
        to fine-tune everything.
      </p>
    </>
  );
}
