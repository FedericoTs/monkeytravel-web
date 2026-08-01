"use client";

/**
 * AnchorEditor — step-1 "I have fixed plans" panel (F1 of
 * docs/CONSTRAINT_PLANNER_PLAN.md).
 *
 * Lets the traveller declare fixed commitments (flights, weddings, booked
 * nights) BEFORE generation so the planner builds around them instead of
 * offering its own trip. Collapsed by default to a single small text button:
 * step-1→2 conversion is the fragile guardrail metric (task #371), so the
 * closed state must add near-zero visual weight.
 *
 * Pure UI — all constraint logic lives server-side in lib/ai/anchors-core.
 * No Places calls of any kind here (plan §6): location is free text.
 */
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AnchorSlot, AnchorType, TripAnchor } from "@/types";
import { addDaysISO } from "@/lib/ai/multi-city-core";

// Mirrors lib/ai/anchors-core.MAX_ANCHORS (kept local so the solver module
// stays out of the client bundle).
const MAX_ANCHORS = 20;

const ANCHOR_TYPES: AnchorType[] = ["transport", "event", "lodging", "meetup", "custom"];

const TYPE_ICONS: Record<AnchorType, string> = {
  transport: "✈️",
  event: "🎉",
  lodging: "🛏️",
  meetup: "👋",
  custom: "📌",
};

const SLOTS: AnchorSlot[] = ["all_day", "morning", "afternoon", "evening"];

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface AnchorEditorProps {
  anchors: TripAnchor[];
  onChange: (anchors: TripAnchor[]) => void;
  startDate: string;
  endDate: string;
}

export default function AnchorEditor({ anchors, onChange, startDate, endDate }: AnchorEditorProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [expanded, setExpanded] = useState(anchors.length > 0);
  const [draft, setDraft] = useState<{
    date: string;
    type: AnchorType;
    title: string;
    location: string;
    slot: AnchorSlot;
  }>({ date: "", type: "event", title: "", location: "", slot: "all_day" });

  // Every date of the trip, capped defensively (route caps the range anyway).
  const dates = useMemo(() => {
    if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || endDate < startDate) return [];
    const out: string[] = [];
    for (let i = 0; i < 31; i++) {
      const d = addDaysISO(startDate, i);
      if (d > endDate) break;
      out.push(d);
    }
    return out;
  }, [startDate, endDate]);

  const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

  // Drop anchors that fell outside the range after a date change (the parent
  // keeps state across edits; stale dates would 400 at the API).
  const validAnchors = useMemo(
    () => anchors.filter((a) => a.date >= startDate && a.date <= endDate),
    [anchors, startDate, endDate]
  );
  if (validAnchors.length !== anchors.length) {
    onChange(validAnchors);
  }

  const addAnchor = () => {
    const title = draft.title.trim();
    if (!title || anchors.length >= MAX_ANCHORS || dates.length === 0) return;
    const location = draft.location.trim();
    const anchor: TripAnchor = {
      id: makeId(),
      date: draft.date && dates.includes(draft.date) ? draft.date : dates[0],
      type: draft.type,
      title: title.slice(0, 120),
      ...(location ? { location: location.slice(0, 160) } : {}),
      // Lodging is always an end-of-day constraint — no slot to pick.
      ...(draft.type !== "lodging" ? { time_slot: draft.slot } : {}),
    };
    onChange([...anchors, anchor]);
    setDraft((d) => ({ ...d, title: "", location: "" }));
  };

  const removeAnchor = (id: string) => onChange(anchors.filter((a) => a.id !== id));

  if (dates.length === 0) return null;

  return (
    <div className="mt-3">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] underline-offset-2 hover:underline"
        >
          <span aria-hidden="true">📌</span>
          {t("wizard.anchors.cta")}
          {anchors.length > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-bold text-white">
              {anchors.length}
            </span>
          )}
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <span aria-hidden="true">📌</span>
                {t("wizard.anchors.title")}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{t("wizard.anchors.subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={t("wizard.anchors.collapse")}
              className="rounded p-1 text-slate-400 hover:text-slate-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          </div>

          {/* Existing anchors */}
          {anchors.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {anchors.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs"
                >
                  <span aria-hidden="true">{TYPE_ICONS[a.type] ?? "📌"}</span>
                  <span className="font-medium text-slate-700 whitespace-nowrap">{fmtDate(a.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-900">
                    {a.title}
                    {a.location ? <span className="text-slate-500"> · {a.location}</span> : null}
                  </span>
                  {a.type !== "lodging" && a.time_slot && a.time_slot !== "all_day" && (
                    <span className="hidden sm:inline text-slate-500">
                      {t(`wizard.anchors.slot.${a.time_slot}`)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAnchor(a.id)}
                    aria-label={t("wizard.anchors.remove")}
                    className="rounded p-0.5 text-slate-400 hover:text-red-500"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add form */}
          {anchors.length < MAX_ANCHORS ? (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">
                    {t("wizard.anchors.date")}
                  </span>
                  <select
                    value={draft.date || dates[0]}
                    onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  >
                    {dates.map((d) => (
                      <option key={d} value={d}>
                        {fmtDate(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">
                    {t("wizard.anchors.type")}
                  </span>
                  <select
                    value={draft.type}
                    onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as AnchorType }))}
                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  >
                    {ANCHOR_TYPES.map((ty) => (
                      <option key={ty} value={ty}>
                        {TYPE_ICONS[ty]} {t(`wizard.anchors.type_${ty}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <input
                type="text"
                value={draft.title}
                maxLength={120}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAnchor();
                  }
                }}
                placeholder={t("wizard.anchors.titlePlaceholder")}
                aria-label={t("wizard.anchors.titleLabel")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={draft.location}
                  maxLength={160}
                  onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
                  placeholder={t("wizard.anchors.locationPlaceholder")}
                  aria-label={t("wizard.anchors.locationLabel")}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                {draft.type !== "lodging" ? (
                  <select
                    value={draft.slot}
                    onChange={(e) => setDraft((d) => ({ ...d, slot: e.target.value as AnchorSlot }))}
                    aria-label={t("wizard.anchors.when")}
                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  >
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {t(`wizard.anchors.slot.${s}`)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex items-center px-1 text-[11px] leading-tight text-slate-500">
                    {t("wizard.anchors.lodgingHint")}
                  </div>
                )}
              </div>

              {draft.type !== "lodging" && draft.slot === "all_day" && (
                <p className="text-[11px] text-slate-400">{t("wizard.anchors.allDayHint")}</p>
              )}

              <button
                type="button"
                onClick={addAnchor}
                disabled={!draft.title.trim()}
                className="w-full rounded-lg border border-[var(--primary)] py-2 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)] hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent"
              >
                {t("wizard.anchors.add")}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-slate-400">
              {t("wizard.anchors.limit", { max: MAX_ANCHORS })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
