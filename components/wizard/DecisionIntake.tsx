"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import DateRangePicker from "@/components/ui/DateRangePicker";
import type { TripVibe } from "@/types";
import { trackWizardEvent, type FrontDoorArm } from "./wizardEvents";

// ---------------------------------------------------------------------------
// The /api/ai/decide response contract (Phase 1, already shipped). Local
// mirror — decide has no exported TS type the client can import, so we type
// exactly the fields we read. Keep in lockstep with lib/ai/decide.ts.
// ---------------------------------------------------------------------------
interface TripProposal {
  id: string;
  destination: string; // "City, Country"
  trip_shape: { days: number; pace: "relaxed" | "moderate" | "active"; theme: string };
  why: string;
  tradeoff: string;
  budget_fit: {
    tier: "budget" | "balanced" | "premium";
    rough_total_usd: number;
    note: string;
  };
  suggested_dates: { start: string; end: string }; // "YYYY-MM-DD"
  vibes: TripVibe[]; // 1-3 of the 12-value set
  interests: string[];
}

// apiSuccess(result) does not wrap (wrap defaults false), so the decide body is
// { proposals, meta } at top level — NOT { success, data }.
interface DecideResponse {
  proposals: TripProposal[];
  meta?: unknown;
}

// The typed payload handed back to NewTripWizard.onPick. The wizard owns the
// setters + handleGenerate; this component only produces this shape.
export interface MappedProposal {
  destination: string;
  destinationCoords: { latitude: number; longitude: number } | null;
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
  budgetTier: "budget" | "balanced" | "premium";
  pace: "relaxed" | "moderate" | "active";
  vibes: TripVibe[];
  travelStyle?: "classic" | "backpacker";
  requirements?: string;
}

interface DecisionIntakeProps {
  locale: string;
  onPick: (mapped: MappedProposal) => void;
}

const DECISION_ARM: FrontDoorArm = "decision";

// Local-time Date -> "YYYY-MM-DD". Deliberately NOT date.toISOString() (that
// shifts a day for users ahead of UTC). Mirrors DateRangePicker's own format.
function toLocalISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ISO string -> Date, local-time (mirror of DateRangePicker.parseDate).
function fromLocalISO(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

// Day-inclusive span, mirroring the wizard everywhere (ceil(diff/86400000)+1).
function spanDaysInclusive(startISO: string, endISO: string): number {
  const s = fromLocalISO(startISO);
  const e = fromLocalISO(endISO);
  if (!s || !e) return 0;
  return Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86400000) + 1);
}

// Add N days to an ISO date (local-time), returning ISO.
function addDaysISO(startISO: string, days: number): string {
  const s = fromLocalISO(startISO);
  if (!s) return startISO;
  s.setDate(s.getDate() + days);
  return toLocalISO(s);
}

// Guarantee dates satisfy validateTripParams: not in the past, end > start,
// span <= 14. If the proposal's start is before today, shift the whole window
// forward preserving its length; clamp span to 14.
function sanitizeDates(startISO: string, endISO: string): { start: string; end: string } {
  const today = toLocalISO(new Date());
  let start = startISO;

  // Preserve the proposal's length (day-inclusive), fall back to 5 days.
  let len = spanDaysInclusive(startISO, endISO);
  if (!len || len < 1) len = 5;
  if (len > 14) len = 14;

  // Shift a missing/past start forward to today.
  if (!fromLocalISO(start) || start < today) {
    start = today;
  }
  // Rebuild end = start + (len - 1): day-inclusive `len` days, always > start.
  const end = addDaysISO(start, len - 1);
  return { start, end };
}

// Map a proposal onto the wizard-state shape. Dates sanitized; vibes passed
// through (already the 12-value set); theme folded into requirements so it
// isn't lost (handleGenerate overwrites interests from vibes downstream).
function mapProposal(p: TripProposal): MappedProposal {
  const { start, end } = sanitizeDates(p.suggested_dates.start, p.suggested_dates.end);
  const requirements = p.trip_shape.theme ? `Theme: ${p.trip_shape.theme}` : undefined;
  return {
    destination: p.destination,
    destinationCoords: null, // decide returns no coords; safe to leave null
    startDate: start,
    endDate: end,
    budgetTier: p.budget_fit.tier,
    pace: p.trip_shape.pace,
    vibes: (p.vibes ?? []).slice(0, 3),
    requirements,
    // travelStyle intentionally left undefined; the wizard keeps its "classic"
    // default. A budget trip is not necessarily a backpacker trip.
  };
}

type Phase = "prompt" | "loading" | "options" | "confirm" | "error";

export default function DecisionIntake({ locale, onPick }: DecisionIntakeProps) {
  const t = useTranslations("trips");

  const [phase, setPhase] = useState<Phase>("prompt");
  const [prompt, setPrompt] = useState("");
  const [proposals, setProposals] = useState<TripProposal[]>([]);
  const [selected, setSelected] = useState<TripProposal | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Confirm-dates working state (seeded from the picked proposal, sanitized).
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Once-guard: fire the SHARED step_1 denominator exactly once on mount, so the
  // decision arm and classic wizard share one funnel entry point. Ref (not
  // state) so it never re-fires on re-render / StrictMode double-invoke.
  const step1FiredRef = useRef(false);
  useEffect(() => {
    if (step1FiredRef.current) return;
    step1FiredRef.current = true;
    void trackWizardEvent("step_1_destination_dates", { locale }, DECISION_ARM);
  }, [locale]);

  const today = toLocalISO(new Date());

  const submitPrompt = useCallback(async () => {
    const clean = prompt.trim();
    if (clean.length < 3) {
      setErrMsg(t("decision.error"));
      setPhase("error");
      return;
    }
    setPhase("loading");
    setErrMsg(null);
    // options_requested — the decision arm's "generating"-equivalent.
    void trackWizardEvent("options_requested", { locale }, DECISION_ARM);

    try {
      const res = await fetch("/api/ai/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: clean, locale }),
      });
      if (!res.ok) {
        // 400 (garbage/injection), 429 (rate limit), 503 (kill switch), 500 —
        // all map to the same graceful retry UI; server copy isn't surfaced
        // verbatim so the message stays localized.
        setErrMsg(t("decision.error"));
        setPhase("error");
        return;
      }
      const data = (await res.json()) as DecideResponse;
      const list = Array.isArray(data.proposals) ? data.proposals : [];
      if (list.length === 0) {
        setErrMsg(t("decision.error"));
        setPhase("error");
        return;
      }
      setProposals(list.slice(0, 3));
      setPhase("options");
      // options_shown = the decision arm's proposal-level first value. Fire BOTH
      // options_shown AND the shared first_value here, per the migration
      // contract ("decision arm fires first_value alongside options_shown").
      void trackWizardEvent("options_shown", { locale }, DECISION_ARM);
      void trackWizardEvent("first_value", { locale }, DECISION_ARM);
    } catch {
      setErrMsg(t("decision.error"));
      setPhase("error");
    }
  }, [prompt, locale, t]);

  const pickProposal = useCallback((p: TripProposal) => {
    const { start, end } = sanitizeDates(p.suggested_dates.start, p.suggested_dates.end);
    setSelected(p);
    setStartDate(start);
    setEndDate(end);
    setPhase("confirm");
  }, []);

  const confirmAndGenerate = useCallback(() => {
    if (!selected) return;
    // Guard the mandatory confirm-dates step: valid, ordered.
    if (!startDate || !endDate || new Date(endDate) < new Date(startDate)) return;
    const mapped = mapProposal({
      ...selected,
      suggested_dates: { start: startDate, end: endDate },
    });
    onPick(mapped);
  }, [selected, startDate, endDate, onPick]);

  // ------------------------------------------------------------------ render
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-2xl mx-auto px-4 py-10 sm:py-16">
        {/* PROMPT + ERROR share the same textarea shell */}
        {(phase === "prompt" || phase === "error") && (
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1 sm:mb-2">
              {t("decision.promptLabel")}
            </h1>
            <p className="text-slate-600 mb-6">{t("decision.promptSubtitle")}</p>

            <label
              htmlFor="decision-prompt"
              className="sr-only"
            >
              {t("decision.promptLabel")}
            </label>
            <textarea
              id="decision-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("decision.promptPlaceholder")}
              rows={3}
              maxLength={500}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors resize-none text-sm"
            />

            {phase === "error" && errMsg && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-slate-700">
                {errMsg}
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={submitPrompt}
                disabled={prompt.trim().length < 3}
                className="w-full sm:w-auto bg-[var(--primary)] text-white px-8 py-3.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 active:bg-[var(--primary)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] sm:min-h-0"
              >
                {phase === "error" ? t("generation.retry") : t("decision.propose")}
              </button>
              {/* Escape hatch to the classic planner. ?front_door=wizard is
                  honored by NewTripWizard's arm computation (query override
                  wins over the flag variant). */}
              <Link
                href={`/${locale}/trips/new?front_door=wizard`}
                className="w-full sm:w-auto text-center px-4 py-3 sm:py-2.5 text-slate-600 hover:text-slate-900 font-medium rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors min-h-[44px]"
              >
                {t("decision.useClassicPlanner")}
              </Link>
            </div>
          </div>
        )}

        {/* LOADING */}
        {phase === "loading" && (
          <div className="text-center py-20">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[var(--primary)]" />
            <p className="mt-4 text-slate-600">{t("decision.loading")}</p>
          </div>
        )}

        {/* OPTIONS — 2-3 proposal cards */}
        {phase === "options" && (
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1 sm:mb-2">
              {t("decision.optionsTitle")}
            </h1>
            <div className="mt-6 space-y-4">
              {proposals.map((p) => (
                <div
                  key={p.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-lg font-semibold text-slate-900">
                      {p.destination}
                    </h2>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {p.trip_shape.days}d · {p.trip_shape.pace}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-900">
                      {t("decision.whyThis")}:{" "}
                    </span>
                    {p.why}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium text-slate-900">
                      {t("decision.tradeoff")}:{" "}
                    </span>
                    {p.tradeoff}
                  </p>

                  <p className="mt-3 text-xs text-slate-500">
                    {t("decision.budgetDatesLine", {
                      budget: t(`decision.tiers.${p.budget_fit.tier}`),
                      dateRange: `${p.suggested_dates.start} → ${p.suggested_dates.end}`,
                    })}
                  </p>

                  <button
                    type="button"
                    onClick={() => pickProposal(p)}
                    className="mt-4 w-full sm:w-auto bg-[var(--accent)] text-slate-900 px-6 py-2.5 rounded-xl font-medium hover:bg-[var(--accent)]/90 active:bg-[var(--accent)]/80 transition-colors min-h-[48px] sm:min-h-0"
                  >
                    {t("decision.chooseThis")}
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={() => setPhase("prompt")}
                className="flex items-center gap-2 px-4 py-3 sm:py-2.5 text-slate-600 hover:text-slate-900 font-medium rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors min-h-[44px]"
              >
                ← {t("decision.startOver")}
              </button>
            </div>
          </div>
        )}

        {/* CONFIRM DATES — MANDATORY before generate (guards validateTripParams) */}
        {phase === "confirm" && selected && (
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1 sm:mb-2">
              {selected.destination}
            </h1>
            <p className="text-slate-600 mb-6">{t("decision.confirmDatesSubtitle")}</p>

            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={(d) => setStartDate(d)}
              onEndDateChange={(d) => setEndDate(d)}
              maxDays={14}
              minDate={today}
              ariaRequired
            />

            <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={confirmAndGenerate}
                disabled={
                  !startDate ||
                  !endDate ||
                  new Date(endDate) < new Date(startDate)
                }
                className="w-full sm:w-auto bg-emerald-500 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] sm:min-h-0"
              >
                {t("decision.confirmDates")}
              </button>
              <button
                type="button"
                onClick={() => setPhase("options")}
                className="flex items-center gap-2 px-4 py-3 sm:py-2.5 text-slate-600 hover:text-slate-900 font-medium rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors min-h-[44px]"
              >
                ← {t("decision.backToOptions")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
