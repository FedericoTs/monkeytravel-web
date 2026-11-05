"use client";

import { useState, useCallback } from "react";
import type { Ux10xBaseline } from "@/app/api/admin/ux10x-baseline/route";
import { RefreshIcon } from "./icons";

// ===========================================================================
// Ux10xBaselineCard — the North Star card (UX10X Master Plan Phase 0.5)
//
// Self-contained: its own fetch to /api/admin/ux10x-baseline, triggered by a
// button so it doesn't add load to the main stats call. Headlines Weekly
// Active Crews (the North Star), the pure-wizard step1->2 conversion, and a
// compact trailing-7d strip + 21-day sparkline,
// each shown against the frozen baseline the initiative is measured against.
// ===========================================================================

export function Ux10xBaselineCard() {
  const [data, setData] = useState<Ux10xBaseline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/ux10x-baseline");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = (await res.json()) as Ux10xBaseline;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const crews = data?.rates.weeklyActiveCrews ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header band */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-[var(--primary)]/10 to-transparent border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--foreground)] flex items-center gap-2">
            <span>🎯</span> UX10X North Star
          </h3>
          <p className="text-[11px] text-slate-500 truncate">
            Weekly Active Crews — trips with ≥2 humans deciding
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[var(--primary)] hover:opacity-90 text-white rounded-lg text-sm transition disabled:opacity-50"
        >
          <RefreshIcon spinning={loading} />
          {data ? "Refresh" : "Load"}
        </button>
      </div>

      <div className="p-4 sm:p-5">
        {!data && !error && !loading && (
          <p className="text-sm text-slate-500 text-center py-4">
            Click “Load” to compute the baseline (a couple of DB queries).
          </p>
        )}
        {loading && !data && (
          <p className="text-sm text-slate-500 text-center py-4 animate-pulse">
            Computing baseline…
          </p>
        )}
        {error && (
          <div className="text-sm text-rose-600 text-center py-4">
            {error}{" "}
            <button onClick={load} className="underline hover:no-underline">
              Retry
            </button>
          </div>
        )}

        {data && (
          <div className="space-y-5">
            {/* North Star headline */}
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
                  Weekly Active Crews
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-4xl font-bold ${
                      crews > 0 ? "text-[var(--primary-ink)]" : "text-slate-300"
                    }`}
                  >
                    {crews}
                  </span>
                  <span className="text-xs text-slate-500">/ target &gt;10</span>
                </div>
              </div>
              <div className="text-right text-[11px] text-slate-500 leading-tight">
                <div>baseline {data.frozenBaseline.weeklyActiveCrews}</div>
                <div>{data.frozenBaseline.label}</div>
              </div>
            </div>

            {/* Rate + trailing-7d strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <BaselineStat
                label="Step 1→2"
                value={`${data.rates.step1To2Pct}%`}
                baseline={`${data.frozenBaseline.step1To2Pct}%`}
              />
              <BaselineStat
                label="Anon starts 7d"
                value={data.last7d.anonStep1Sessions}
                baseline={`~${Math.round(data.frozenBaseline.anonStep1PerDayMedian * 7)}`}
              />
              <BaselineStat
                label="Saves 7d"
                value={data.last7d.saves}
                baseline={`~${Math.round(data.frozenBaseline.savesPerDay * 7)}`}
              />
              <BaselineStat
                label="Shares 7d"
                value={data.last7d.tripsShared}
              />
              <BaselineStat
                label="AI convos 7d"
                value={data.last7d.aiConversations}
                baseline={`~${Math.round(data.frozenBaseline.aiConversationsPerDay * 7)}`}
              />
            </div>

            {/* 21-day anonymous-starts sparkline */}
            <BaselineSparkline daily={data.daily} />

            <p className="text-[10px] text-slate-500">
              Updated {new Date(data.generatedAt).toLocaleString()}. Crews counts
              a second human voting or joining — passive share-visits excluded.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BaselineStat({
  label,
  value,
  baseline,
}: {
  label: string;
  value: string | number;
  baseline?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium truncate">
        {label}
      </div>
      <div className="text-lg font-semibold text-[var(--foreground)] leading-tight">
        {value}
      </div>
      {baseline && (
        <div className="text-[10px] text-slate-500">base {baseline}</div>
      )}
    </div>
  );
}

function BaselineSparkline({ daily }: { daily: Ux10xBaseline["daily"] }) {
  // View is day-DESC; take the most recent 21 days and render oldest→newest.
  const rows = daily.slice(0, 21).slice().reverse();
  const max = Math.max(1, ...rows.map((r) => r.anonStep1Sessions));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
          Anon step-1 starts · last {rows.length}d
        </span>
        <span className="text-[10px] text-slate-500">peak {max}</span>
      </div>
      <div className="flex items-end gap-0.5 h-14">
        {rows.map((r) => (
          <div
            key={r.day}
            className="flex-1 bg-[var(--primary)]/70 rounded-sm min-h-[2px]"
            style={{ height: `${Math.round((r.anonStep1Sessions / max) * 100)}%` }}
            title={`${r.day}: ${r.anonStep1Sessions} starts, ${r.saves} saves`}
          />
        ))}
      </div>
    </div>
  );
}
