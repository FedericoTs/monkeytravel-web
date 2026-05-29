"use client";

/**
 * Hostelworld partner dashboard — client-side renderer.
 *
 * Self-fetches `/api/admin/partners/hostelworld/stats` on mount + on
 * refresh. The page wrapper has already enforced the admin gate, so
 * we don't re-check here — but the API route still checks isAdmin() as
 * defence in depth.
 *
 * No charting library — uses lightweight inline SVG for the daily
 * time-series (mirrors the pattern in components/admin/UserGrowthChart.tsx
 * which also rolls its own SVG instead of pulling in recharts).
 *
 * CSV export uses a Blob + anchor download, no extra endpoint needed —
 * the same /stats response has everything we need to materialise the file.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";

interface DailyRow {
  day: string;
  clicks: number;
  unique_visitors: number;
  unique_trips: number;
  mobile_clicks: number;
  desktop_clicks: number;
  tablet_clicks: number;
  signups: number;
}
interface StatsResponse {
  windowDays: number;
  headline: {
    clicks: number;
    uniqueTrips: number;
    uniqueVisitors: number;
    hostelworldSignups: number;
  };
  daily: DailyRow[];
  topDestinations: Array<{ destination: string; clicks: number; unique_visitors: number }>;
  deviceSplit: { mobile: number; desktop: number; tablet: number };
}

export default function HostelworldDashboard() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/partners/hostelworld/stats", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StatsResponse = await res.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleExportCsv = useCallback(() => {
    if (!stats) return;
    // Header + daily rows. Use ISO dates; no locale-formatting (this is for
    // the partner's spreadsheet, English/numbers only).
    const header = "date,clicks,unique_visitors,unique_trips,mobile,desktop,tablet,signups";
    const rows = stats.daily.map((d) =>
      [d.day, d.clicks, d.unique_visitors, d.unique_trips, d.mobile_clicks, d.desktop_clicks, d.tablet_clicks, d.signups].join(","),
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hostelworld-30d-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [stats]);

  // Chart geometry — fixed dims so SVG stays crisp.
  const chart = useMemo(() => {
    if (!stats?.daily?.length) return null;
    const W = 760;
    const H = 200;
    const padL = 32;
    const padR = 16;
    const padT = 16;
    const padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const maxClicks = Math.max(1, ...stats.daily.map((d) => d.clicks));
    const step = innerW / Math.max(1, stats.daily.length - 1);
    const points = stats.daily.map((d, i) => {
      const x = padL + i * step;
      const y = padT + innerH - (d.clicks / maxClicks) * innerH;
      return { x, y, d };
    });
    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
    return { W, H, padL, padT, innerH, points, linePath, areaPath, maxClicks };
  }, [stats]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <Link href="/admin" className="hover:text-slate-900">Admin</Link>
            <span>/</span>
            <span>Partners</span>
            <span>/</span>
            <span className="text-slate-900 font-medium">Hostelworld</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-60"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button
              onClick={handleExportCsv}
              disabled={!stats}
              className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 border border-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60"
            >
              Export CSV
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hostelworld Partner Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Rolling 30-day window. Numbers come from <code className="bg-slate-100 px-1.5 py-0.5 rounded">public.hostelworld_clicks</code> + Hostelworld-attributed signups.
          </p>
        </div>

        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-700">
            Failed to load: {error}
          </div>
        )}

        {/* Headline tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Clicks (30d)", value: stats?.headline.clicks, hint: "All clicks to Hostelworld via our CTA" },
            { label: "Unique trips", value: stats?.headline.uniqueTrips, hint: "Distinct itineraries triggering a click" },
            { label: "Unique travellers", value: stats?.headline.uniqueVisitors, hint: "Deduped users + anon cookies" },
            { label: "Signups attributed", value: stats?.headline.hostelworldSignups, hint: "users.acquisition_source = 'hostelworld'" },
          ].map((tile) => (
            <div key={tile.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{tile.label}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
                {stats ? (tile.value ?? 0).toLocaleString("en-US") : "—"}
              </p>
              <p className="mt-1 text-xs text-slate-400">{tile.hint}</p>
            </div>
          ))}
        </div>

        {/* Daily clicks chart */}
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Daily clicks — last {stats?.windowDays ?? 30} days</h2>
          {chart ? (
            <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full h-auto">
              {/* baseline grid */}
              {[0.25, 0.5, 0.75, 1].map((frac) => (
                <line
                  key={frac}
                  x1={chart.padL}
                  x2={chart.W - 16}
                  y1={chart.padT + chart.innerH * frac}
                  y2={chart.padT + chart.innerH * frac}
                  stroke="#e2e8f0"
                  strokeDasharray="2,3"
                />
              ))}
              {/* area + line */}
              <path d={chart.areaPath} fill="rgba(16,185,129,0.15)" />
              <path d={chart.linePath} stroke="#059669" strokeWidth={2} fill="none" />
              {/* points */}
              {chart.points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#059669">
                  <title>{`${p.d.day} — ${p.d.clicks} clicks, ${p.d.unique_visitors} visitors, ${p.d.signups} signups`}</title>
                </circle>
              ))}
              {/* axis label */}
              <text x={chart.padL} y={chart.padT + chart.innerH + 18} fontSize={10} fill="#94a3b8">
                {chart.points[0]?.d.day}
              </text>
              <text x={chart.W - 16} y={chart.padT + chart.innerH + 18} fontSize={10} fill="#94a3b8" textAnchor="end">
                {chart.points[chart.points.length - 1]?.d.day}
              </text>
            </svg>
          ) : loading ? (
            <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">Loading chart…</div>
          ) : (
            <p className="text-sm text-slate-500">No data yet.</p>
          )}
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Top destinations */}
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Top 10 destinations clicked</h2>
            {stats?.topDestinations.length ? (
              <ol className="space-y-2">
                {stats.topDestinations.map((row, i) => {
                  const max = stats.topDestinations[0].clicks || 1;
                  const pct = (row.clicks / max) * 100;
                  return (
                    <li key={`${row.destination}-${i}`} className="text-sm">
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="font-medium text-slate-900 truncate">{i + 1}. {row.destination}</span>
                        <span className="tabular-nums text-slate-500">{row.clicks} ({row.unique_visitors} pp)</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">No destination data yet.</p>
            )}
          </section>

          {/* Device split */}
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Device split (30d)</h2>
            {stats && (stats.deviceSplit.mobile + stats.deviceSplit.desktop + stats.deviceSplit.tablet) > 0 ? (
              <div className="space-y-3">
                {(["mobile", "desktop", "tablet"] as const).map((key) => {
                  const total = stats.deviceSplit.mobile + stats.deviceSplit.desktop + stats.deviceSplit.tablet || 1;
                  const value = stats.deviceSplit[key];
                  const pct = Math.round((value / total) * 100);
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="capitalize text-slate-700">{key}</span>
                        <span className="tabular-nums text-slate-500">{value} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-slate-400 mt-2">
                  Hostelworld&apos;s mobile inventory is their growth narrative — this is the slide they want.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No device data yet.</p>
            )}
          </section>
        </div>

        {/* Daily table (compact, scroll if long) */}
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Daily breakdown</h2>
          {stats?.daily.length ? (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium text-right">Clicks</th>
                    <th className="py-2 pr-3 font-medium text-right">Visitors</th>
                    <th className="py-2 pr-3 font-medium text-right">Trips</th>
                    <th className="py-2 pr-3 font-medium text-right">Signups</th>
                    <th className="py-2 pr-3 font-medium text-right">M / D / T</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {stats.daily.map((d) => (
                    <tr key={d.day} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pr-3 tabular-nums">{d.day}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{d.clicks}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{d.unique_visitors}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{d.unique_trips}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{d.signups}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">
                        {d.mobile_clicks}/{d.desktop_clicks}/{d.tablet_clicks}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No data.</p>
          )}
        </section>
      </main>
    </div>
  );
}
