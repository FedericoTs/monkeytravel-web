"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { BudgetTier } from "@/lib/explore/types";

/**
 * URL-synced filter chips for /explore. Pure client component — the
 * server-rendered <ExploreFeed /> picks up the new querystring on
 * navigation.
 *
 * Why URL-state (not React state):
 *   - Filter state survives browser back/forward + reload
 *   - Filtered views are linkable + shareable
 *   - SEO: each meaningful combination is its own indexable URL
 *
 * Design note: we keep the filter set small in v1 (destination free-
 * text, budget, duration band, tag). Vibe filter ships when we wire
 * the vibe→tag mapping at the publish step.
 */

const BUDGET_OPTIONS: { value: BudgetTier; labelKey: string }[] = [
  { value: "budget", labelKey: "budget.budget" },
  { value: "balanced", labelKey: "budget.balanced" },
  { value: "premium", labelKey: "budget.premium" },
];

const DURATION_OPTIONS: { value: string; min: number; max: number; labelKey: string }[] = [
  { value: "weekend", min: 1, max: 3, labelKey: "duration.weekend" },
  { value: "week", min: 4, max: 9, labelKey: "duration.week" },
  { value: "longer", min: 10, max: 30, labelKey: "duration.tenPlus" },
];

const TAG_OPTIONS = [
  "foodie",
  "adventure",
  "cultural",
  "relaxation",
  "nature",
  "urban",
  "romantic",
  "family",
];

export default function ExploreFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("common.explore.filters");

  const params = useMemo(() => new URLSearchParams(searchParams?.toString() ?? ""), [
    searchParams,
  ]);

  /** Toggle a key: set if missing or value differs; clear if same value. */
  const toggle = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      if (next.get(key) === value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      // Reset pagination when filters change.
      next.delete("page");
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  const setDurationBand = useCallback(
    (min: number, max: number) => {
      const next = new URLSearchParams(params);
      const isSame =
        next.get("duration_min") === String(min) &&
        next.get("duration_max") === String(max);
      if (isSame) {
        next.delete("duration_min");
        next.delete("duration_max");
      } else {
        next.set("duration_min", String(min));
        next.set("duration_max", String(max));
      }
      next.delete("page");
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  const clearAll = useCallback(() => {
    router.push(pathname, { scroll: false });
  }, [pathname, router]);

  const activeBudget = params.get("budget");
  const activeTag = params.get("tags");
  const activeDurationMin = params.get("duration_min");
  const activeDurationMax = params.get("duration_max");
  const activeTravelStyle = params.get("travel_style");
  const hasAny =
    params.get("budget") ||
    params.get("tags") ||
    params.get("destination") ||
    params.get("duration_min") ||
    params.get("travel_style");

  return (
    <div className="flex flex-col gap-4">
      {/* Destination free-text */}
      <input
        type="search"
        placeholder={t("searchPlaceholder")}
        defaultValue={params.get("destination") ?? ""}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const v = (e.target as HTMLInputElement).value.trim();
          const next = new URLSearchParams(params);
          if (v) next.set("destination", v);
          else next.delete("destination");
          next.delete("page");
          router.push(`${pathname}?${next.toString()}`, { scroll: false });
        }}
        className="w-full sm:max-w-md rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
        aria-label={t("searchAriaLabel")}
      />

      {/* Travel style — single Backpacker toggle (binary filter).
          Emerald to match the wizard toggle + the per-trip badge.
          Sits at the top of the chip stack because it's the most
          opinionated filter and the Hostelworld partnership wedge. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mr-1">
          {t("style")}
        </span>
        <button
          onClick={() => toggle("travel_style", "backpacker")}
          aria-pressed={activeTravelStyle === "backpacker"}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${
            activeTravelStyle === "backpacker"
              ? "bg-emerald-500 text-white border-emerald-500"
              : "bg-white text-slate-700 border-slate-300 hover:border-emerald-500"
          }`}
        >
          <span aria-hidden>🎒</span>
          {t("backpacker")}
        </button>
      </div>

      {/* Budget chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mr-1">
          {t("budgetLabel")}
        </span>
        {BUDGET_OPTIONS.map((opt) => {
          const isActive = activeBudget === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => toggle("budget", opt.value)}
              className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                isActive
                  ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                  : "bg-white text-slate-700 border-slate-300 hover:border-[var(--primary)]"
              }`}
              aria-pressed={isActive}
            >
              {t(opt.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Duration chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mr-1">
          {t("lengthLabel")}
        </span>
        {DURATION_OPTIONS.map((opt) => {
          const isActive =
            activeDurationMin === String(opt.min) &&
            activeDurationMax === String(opt.max);
          return (
            <button
              key={opt.value}
              onClick={() => setDurationBand(opt.min, opt.max)}
              className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                isActive
                  ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                  : "bg-white text-slate-700 border-slate-300 hover:border-[var(--primary)]"
              }`}
              aria-pressed={isActive}
            >
              {t(opt.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Tag chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mr-1">
          {t("vibeLabel")}
        </span>
        {TAG_OPTIONS.map((tag) => {
          const isActive = activeTag === tag;
          return (
            <button
              key={tag}
              onClick={() => toggle("tags", tag)}
              className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                isActive
                  ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                  : "bg-white text-slate-700 border-slate-300 hover:border-[var(--primary)]"
              }`}
              aria-pressed={isActive}
            >
              {t(`tags.${tag}`)}
            </button>
          );
        })}
      </div>

      {hasAny && (
        <button
          onClick={clearAll}
          className="self-start text-sm text-slate-500 underline hover:text-slate-900"
        >
          {t("clearAll")}
        </button>
      )}
    </div>
  );
}
