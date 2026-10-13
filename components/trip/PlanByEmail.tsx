"use client";

/**
 * The share page's ask under the plan: "Coming on this trip?" and an email
 * field. One tap says they're going and emails them the plan (POST /join with
 * the address; the route sends it once per trip and says how that went). Its
 * state is the "I'm going" bar's, through lib/participants/live-store.
 */
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import {
  normalizeEmail,
  type JoinResponse,
  type ParticipantSource,
  type ParticipantsResponse,
  type PlanEmailOutcome,
} from "@/lib/participants/shared";
import { publishParticipants, subscribeParticipants } from "@/lib/participants/live-store";

interface PlanByEmailProps {
  shareToken: string;
  source: ParticipantSource;
  /** A signed-in viewer's address, filled in for them to confirm. */
  defaultEmail?: string | null;
}

export default function PlanByEmail({ shareToken, source, defaultEmail }: PlanByEmailProps) {
  const t = useTranslations("common.share");
  const locale = useLocale();
  const [me, setMe] = useState<ParticipantsResponse["me"] | null>(null);
  const [email, setEmail] = useState(defaultEmail ?? "");
  // Someone already getting this trip's emails sees the form only on request.
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ outcome: PlanEmailOutcome; to: string } | null>(null);

  useEffect(
    () =>
      subscribeParticipants(shareToken, (snapshot) => {
        setMe(snapshot.me);
        if (!snapshot.me.joined) setResult(null);
      }),
    [shareToken],
  );

  // The account resolves after the first render.
  useEffect(() => {
    if (defaultEmail) setEmail((current) => current || defaultEmail);
  }, [defaultEmail]);

  const joined = me?.joined ?? false;
  const showForm = !joined || (!result && (!me?.has_email || open));

  const submit = async () => {
    const address = normalizeEmail(email);
    if (!address) {
      setError(t("planByEmail.invalidEmail"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // "join" also covers someone already going: it saves the address on their row.
      const res = await fetch(`/api/shared/${shareToken}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", source, locale, email: address }),
      });
      if (!res.ok) throw new Error(`join failed: ${res.status}`);
      const next = (await res.json()) as JoinResponse;
      setResult({ outcome: next.plan_email ?? "not_sent", to: address });
      setOpen(false);
      publishParticipants(shareToken, next);
    } catch {
      setError(t("participants.error"));
    } finally {
      setBusy(false);
    }
  };

  if (!showForm) {
    return (
      <div data-testid="plan-by-email" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
        <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700">
          <Check className="h-4 w-4" aria-hidden="true" />
          {t("participants.youreIn")}
        </span>
        {result ? (
          <span role="status" data-testid="plan-by-email-result" className="text-sm text-slate-700">
            {result.outcome === "sent"
              ? t("planByEmail.sent", { email: result.to })
              : result.outcome === "already"
                ? t("planByEmail.already", { email: result.to })
                : t("planByEmail.notSent")}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-sm font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
          >
            {t("planByEmail.submitJoined")}
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      data-testid="plan-by-email"
      className="mx-auto max-w-md space-y-3"
      // The address is checked below, so a wrong one is explained in the page's language.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="text-center">
        <h3 className="text-lg font-semibold text-slate-900">
          {joined ? t("planByEmail.titleJoined") : t("planByEmail.title")}
        </h3>
        <p className="mt-1 text-sm text-slate-600">{joined ? t("planByEmail.bodyJoined") : t("planByEmail.body")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="plan-by-email-address" className="sr-only">
          {t("planByEmail.emailLabel")}
        </label>
        <input
          id="plan-by-email-address"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          maxLength={254}
          autoComplete="email"
          placeholder={t("participants.emailPlaceholder")}
          disabled={busy}
          className="min-h-[48px] min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-500 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-sm font-semibold text-white shadow-lg shadow-[var(--primary)]/25 transition-colors hover:bg-[var(--primary-dark)] disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {busy ? t("planByEmail.sending") : joined ? t("planByEmail.submitJoined") : t("planByEmail.submit")}
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">{t("planByEmail.privacy")}</p>
      {error && (
        <p role="alert" className="text-center text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
