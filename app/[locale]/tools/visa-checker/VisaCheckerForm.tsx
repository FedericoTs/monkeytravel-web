"use client";

/**
 * Visa Checker form — passport + destination + check.
 *
 * Submitting the form pushes `?from=XX&to=YY` to the URL. The server
 * component above reads those query params and renders the result
 * server-side (better for SEO than a client fetch). The "Swap" button
 * exchanges passport and destination — handy for round-trip planners.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CountryOption } from "@/lib/visa/countries";

interface Props {
  locale: string;
  options: CountryOption[];
  defaultFrom?: string;
  defaultTo?: string;
}

export default function VisaCheckerForm({
  locale,
  options,
  defaultFrom,
  defaultTo,
}: Props) {
  const t = useTranslations("tools.visaChecker");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [from, setFrom] = useState(defaultFrom?.toUpperCase() || "");
  const [to, setTo] = useState(defaultTo?.toUpperCase() || "");
  const [isPending, startTransition] = useTransition();

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const canSubmit = from.length === 2 && to.length === 2 && !isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("from", from);
    params.set("to", to);
    startTransition(() => {
      // Best-effort PostHog event (loaded globally on the app)
      if (typeof window !== "undefined") {
        const ph = (
          window as unknown as {
            posthog?: { capture: (e: string, p: Record<string, unknown>) => void };
          }
        ).posthog;
        ph?.capture("tools_visa_checker_query", {
          from,
          to,
          locale,
        });
      }
      router.push(`?${params.toString()}`, { scroll: false });
    });
  };

  // Render every country as a single <option>. 199 entries is well under
  // the browser select-element practical limit (~10k) and pure HTML keeps
  // it accessible and zero-JS for the dropdown itself.
  const sortedOptions = useMemo(
    () => options.slice().sort((a, b) => a.name.localeCompare(b.name, locale)),
    [options, locale]
  );

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm"
    >
      <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-2 items-end">
        <div>
          <label
            htmlFor="visa-from"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {t("passportLabel")}
          </label>
          <select
            id="visa-from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            required
          >
            <option value="" disabled>
              {t("selectPassport")}
            </option>
            {sortedOptions.map((opt) => (
              <option key={`from-${opt.iso2}`} value={opt.iso2}>
                {opt.flag} {opt.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={swap}
          className="hidden sm:inline-flex items-center justify-center h-11 w-11 rounded-lg border border-slate-300 text-slate-500 hover:text-slate-900 hover:border-slate-400 transition self-end"
          aria-label={t("swapButton")}
          title={t("swapButton")}
        >
          ⇆
        </button>

        <div>
          <label
            htmlFor="visa-to"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {t("destinationLabel")}
          </label>
          <select
            id="visa-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            required
          >
            <option value="" disabled>
              {t("selectDestination")}
            </option>
            {sortedOptions.map((opt) => (
              <option key={`to-${opt.iso2}`} value={opt.iso2}>
                {opt.flag} {opt.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mobile-only swap (full-width, after both selects) */}
      <button
        type="button"
        onClick={swap}
        className="sm:hidden mt-3 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:text-slate-900 hover:border-slate-400 transition w-full"
      >
        ⇆ {t("swapButton")}
      </button>

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-3 text-base font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {isPending ? t("loadingResult") : t("checkButton")}
      </button>
    </form>
  );
}
