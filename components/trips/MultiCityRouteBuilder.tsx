"use client";

/**
 * Multi-city route builder — the INPUT half of the multi-city wedge (§3.2).
 *
 * Repeatable city + nights rows: add up to `maxCities`, remove down to
 * `minCities`. Fully controlled — owns no state; the parent holds the rows
 * array. Reused by the multi-city preview page and (next) the NewTripWizard
 * multi-city mode, so the look + behaviour stay consistent across both.
 */
import type { ChangeEvent } from "react";
import { useTranslations } from "next-intl";

export interface RouteStop {
  city: string;
  nights: number;
}

const DEFAULT_MAX = 5;
const DEFAULT_MIN = 2;

export function MultiCityRouteBuilder({
  rows,
  onChange,
  maxCities = DEFAULT_MAX,
  minCities = DEFAULT_MIN,
  className = "",
}: {
  rows: RouteStop[];
  onChange: (rows: RouteStop[]) => void;
  maxCities?: number;
  minCities?: number;
  className?: string;
}) {
  const t = useTranslations("trips");
  function updateRow(i: number, patch: Partial<RouteStop>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    if (rows.length >= maxCities) return;
    onChange([...rows, { city: "", nights: 2 }]);
  }
  function removeRow(i: number) {
    if (rows.length <= minCities) return;
    onChange(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className={className}>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
              {i + 1}
            </span>
            <input
              type="text"
              value={row.city}
              onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { city: e.target.value })}
              placeholder={t("wizard.multiCity.cityPlaceholder", { number: i + 1 })}
              aria-label={t("wizard.multiCity.cityPlaceholder", { number: i + 1 })}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            <div className="flex flex-none items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={10}
                value={row.nights}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  updateRow(i, { nights: Number(e.target.value) })
                }
                aria-label={t("wizard.multiCity.nightsAria", { number: i + 1 })}
                className="w-16 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <span className="text-sm text-slate-500">{t("wizard.multiCity.nightsLabel")}</span>
            </div>
            {rows.length > minCities && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={t("wizard.multiCity.removeCityAria", { number: i + 1 })}
                className="flex-none rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {rows.length < maxCities && (
        <button
          type="button"
          onClick={addRow}
          className="mt-3 text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          {t("wizard.multiCity.addCity")}
        </button>
      )}
    </div>
  );
}
