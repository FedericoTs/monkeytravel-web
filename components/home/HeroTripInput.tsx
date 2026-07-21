"use client";

import { useState } from "react";
import { useRouter } from "@/lib/i18n/routing";

/**
 * Homepage hero destination input. Puts the first real action on screen one:
 * the visitor types where they want to go and lands in the wizard with the
 * destination already prefilled (via ?destination=). Collapses
 * "click CTA → load wizard → find field → type" into "type → go".
 *
 * The wizard resolves the param on mount (NewTripWizard prefill effect,
 * ~line 470), so no server round-trip is needed to carry the value across.
 * Funnel audit Rank 7 / fd-01. Submitting empty still goes to the wizard.
 *
 * The one-tap starter chips give a ZERO-typing path for visitors who hit a
 * blank field and stall (cold-start paralysis) — each chip does exactly what
 * typing the destination + submitting does, so it lifts the homepage→wizard
 * entry rate without adding a decision.
 */
export default function HeroTripInput({
  placeholder,
  cta,
  startersLabel,
  starters = [],
}: {
  placeholder: string;
  cta: string;
  startersLabel?: string;
  starters?: string[];
}) {
  const router = useRouter();
  const [value, setValue] = useState("");

  // Carry a destination into the wizard with it prefilled. Empty → plain wizard.
  const go = (dest: string) => {
    const v = dest.trim();
    router.push(v ? `/trips/new?destination=${encodeURIComponent(v)}` : "/trips/new");
  };

  return (
    <div className="w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        className="flex w-full flex-col gap-3 sm:flex-row"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={120}
          className="min-w-0 flex-1 rounded-xl border-2 border-gray-200 bg-white px-5 py-4 text-base text-[var(--foreground)] shadow-sm placeholder:text-[var(--foreground-muted)] focus:border-[var(--primary)] focus:outline-none"
        />
        <button
          type="submit"
          className="group flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[var(--primary)] px-8 py-4 font-semibold text-white transition-all hover:bg-[var(--primary)]/90"
        >
          <span>{cta}</span>
          <svg
            className="h-5 w-5 transition-transform group-hover:translate-x-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </form>

      {starters.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
          {startersLabel && (
            <span className="text-sm text-[var(--foreground-muted)]">{startersLabel}</span>
          )}
          {starters.map((dest) => (
            <button
              key={dest}
              type="button"
              onClick={() => go(dest)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              {dest}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
