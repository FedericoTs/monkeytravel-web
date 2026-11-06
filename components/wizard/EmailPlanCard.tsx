"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { emailKeptPlan, type PlanEmailOutcome } from "@/lib/plans/kept-plans-client";
import { capture } from "@/lib/posthog";

/**
 * Sends a kept plan's link to the address a signed-out planner types, with no
 * account (lib/plans/kept-plan-email.ts). A card beside the plan rather than a
 * dialog over it, so reading goes on behind it. `offered` when the planner
 * didn't ask for it: it then says why it's there, and leaves the keyboard shut.
 */
export function EmailPlanCard({ token, offered, onClose }: { token: string; offered: boolean; onClose: () => void }) {
  const t = useTranslations("trips");
  const tButtons = useTranslations("common.buttons");
  const locale = useLocale();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | PlanEmailOutcome>("idle");

  useEffect(() => {
    if (!offered) inputRef.current?.focus();
  }, [offered]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!email || status === "sending") return;
    setStatus("sending");
    const outcome = await emailKeptPlan(token, email, locale);
    setStatus(outcome);
    void capture("kept_plan_email", { outcome, offered });
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={`${id}-title`} className="text-sm font-semibold text-slate-900">
          {offered ? t("wizard.kept.emailOffer") : t("wizard.kept.emailAction")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={tButtons("closeModal")}
          className="-m-1 shrink-0 rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {status === "sent" ? (
        <p role="status" className="text-sm text-slate-700">
          {t("wizard.kept.emailSent", { email })}
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-600">{t("wizard.kept.emailNote")}</p>
          <form onSubmit={(event) => void send(event)} className="flex items-center gap-2">
            <label htmlFor={`${id}-email`} className="sr-only">
              {t("wizard.kept.emailLabel")}
            </label>
            <input
              ref={inputRef}
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("wizard.kept.emailPlaceholder")}
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-base text-slate-900 outline-none focus:border-[var(--secondary-ink)] focus:ring-2 focus:ring-[var(--secondary-ink)]/20 sm:text-sm"
            />
            <button
              type="submit"
              disabled={status === "sending" || !email}
              className="min-h-[44px] shrink-0 rounded-xl bg-[var(--secondary-ink)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--secondary-ink)]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "sending" ? t("wizard.kept.emailSending") : t("wizard.kept.emailSend")}
            </button>
          </form>
          {status === "invalid" && (
            <p role="alert" className="text-xs text-rose-700">
              {t("wizard.kept.emailInvalid")}
            </p>
          )}
          {status === "limited" && (
            <p role="alert" className="text-xs text-rose-700">
              {t("wizard.kept.emailLimited")}
            </p>
          )}
          {status === "failed" && (
            <p role="alert" className="text-xs text-rose-700">
              {t("wizard.kept.emailFailed")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
