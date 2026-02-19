"use client";

import { useState, useMemo, useEffect, useRef } from "react";

interface TrafficData {
  daily: { date: string; views: number; uniqueVisitors: number }[];
  bySection: { section: string; count: number; uniqueVisitors: number }[];
  conversionFunnel: { step: string; count: number }[];
}

interface TrafficOverviewProps {
  data: TrafficData;
}

type TimeRange = "7d" | "30d" | "90d";

const SECTION_COLORS: Record<string, string> = {
  landing: "#0A4B73",
  trips: "#10b981",
  auth: "#8b5cf6",
  blog: "#f59e0b",
  destinations: "#ec4899",
  profile: "#6366f1",
  admin: "#64748b",
  other: "#94a3b8",
};

const SECTION_LABELS: Record<string, string> = {
  landing: "Landing",
  trips: "Trips",
  auth: "Auth",
  blog: "Blog",
  destinations: "Destinations",
  profile: "Profile",
  admin: "Admin",
  other: "Other",
};

const FUNNEL_LABELS: Record<string, string> = {
  visitors: "Unique Visitors",
  signups: "Signups",
  trip_creators: "Trip Creators",
  shared_trips: "Shared Trips",
};

export default function TrafficOverview({ data }: TrafficOverviewProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isAnimated, setIsAnimated] = useState(false);
  const chartRef = useRef<SVGSVGElement>(null);

  // Filter daily data based on time range
  const filteredDaily = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    return data.daily.slice(-days);
  }, [data.daily, timeRange]);

  // Chart dimensions and data points
  const chartConfig = useMemo(() => {
    const width = 800;
    const height = 240;
    const padding = { top: 30, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    if (filteredDaily.length === 0) {
      return { width, height, padding, chartWidth, chartHeight, points: [], uniquePoints: [], maxValue: 0 };
    }

    const maxValue = Math.max(...filteredDaily.map((d) => d.views), 1);

    const points = filteredDaily.map((d, i) => {
      const x = padding.left + (i / (filteredDaily.length - 1 || 1)) * chartWidth;
      const y = padding.top + chartHeight - (d.views / maxValue) * chartHeight;
      return { x, y, ...d };
    });

    const uniquePoints = filteredDaily.map((d, i) => {
      const x = padding.left + (i / (filteredDaily.length - 1 || 1)) * chartWidth;
      const y = padding.top + chartHeight - (d.uniqueVisitors / maxValue) * chartHeight;
      return { x, y, ...d };
    });

    return { width, height, padding, chartWidth, chartHeight, points, uniquePoints, maxValue };
  }, [filteredDaily]);

  // Bezier curve path generator
  const generatePath = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return "";
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
      const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
      path += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return path;
  };

  const viewsPath = useMemo(() => generatePath(chartConfig.points), [chartConfig.points]);
  const uniquePath = useMemo(() => generatePath(chartConfig.uniquePoints), [chartConfig.uniquePoints]);

  // Area path for views gradient fill
  const areaPath = useMemo(() => {
    if (chartConfig.points.length < 2) return "";
    const { points, padding, chartHeight } = chartConfig;
    const bottomY = padding.top + chartHeight;
    let path = `M ${points[0].x} ${bottomY} L ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
      const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
      path += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    path += ` L ${points[points.length - 1].x} ${bottomY} Z`;
    return path;
  }, [chartConfig]);

  // Y-axis labels
  const yAxisLabels = useMemo(() => {
    const max = chartConfig.maxValue;
    const step = Math.ceil(max / 4);
    return Array.from({ length: 5 }, (_, i) => step * i);
  }, [chartConfig.maxValue]);

  // X-axis labels
  const xAxisLabels = useMemo(() => {
    const step = Math.ceil(filteredDaily.length / 6);
    return filteredDaily
      .filter((_, i) => i % step === 0 || i === filteredDaily.length - 1)
      .map((d) => ({
        date: d.date,
        index: filteredDaily.indexOf(d),
      }));
  }, [filteredDaily]);

  // Period summary stats
  const periodStats = useMemo(() => {
    const totalViews = filteredDaily.reduce((sum, d) => sum + d.views, 0);
    const avgDaily = filteredDaily.length > 0 ? Math.round(totalViews / filteredDaily.length) : 0;
    const peak = filteredDaily.length > 0
      ? filteredDaily.reduce((max, d) => (d.views > max.views ? d : max), filteredDaily[0])
      : null;
    return { totalViews, avgDaily, peak };
  }, [filteredDaily]);

  // Animation trigger
  useEffect(() => {
    setIsAnimated(false);
    const timer = setTimeout(() => setIsAnimated(true), 100);
    return () => clearTimeout(timer);
  }, [timeRange]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Section breakdown calculations
  const totalSectionViews = data.bySection.reduce((sum, s) => sum + s.count, 0);
  const maxSectionCount = Math.max(...data.bySection.map((s) => s.count), 1);

  if (data.daily.length === 0 && data.bySection.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-4 border-b border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </span>
              Traffic Overview
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Page views and visitor trends
            </p>
          </div>

          {/* Time Range Pills */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            {(["7d", "30d", "90d"] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                  timeRange === range
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3 border border-slate-100">
            <div className="text-2xl font-bold text-[var(--foreground)]">
              {periodStats.totalViews.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500">Total Views</div>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl p-3 border border-emerald-100">
            <div className="text-2xl font-bold text-emerald-600">
              {periodStats.avgDaily.toLocaleString()}
            </div>
            <div className="text-xs text-emerald-600">Avg/Day</div>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 rounded-xl p-3 border border-amber-100">
            <div className="text-2xl font-bold text-amber-600">
              {periodStats.peak ? periodStats.peak.views.toLocaleString() : "—"}
            </div>
            <div className="text-xs text-amber-600">
              Peak Day{periodStats.peak ? ` (${formatDate(periodStats.peak.date)})` : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Daily Traffic Chart */}
      {filteredDaily.length > 0 && (
        <div className="p-6 pt-4">
          <div className="flex items-center gap-4 mb-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[var(--primary)] rounded-full" />
              <span className="text-xs text-slate-500">Page Views</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-400 rounded-full" style={{ opacity: 0.7 }} />
              <span className="text-xs text-slate-500">Unique Visitors</span>
            </div>
          </div>
          <svg
            ref={chartRef}
            viewBox={`0 0 ${chartConfig.width} ${chartConfig.height}`}
            className="w-full h-auto"
            style={{ maxHeight: "280px" }}
          >
            <defs>
              <linearGradient id="trafficAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {yAxisLabels.map((label, i) => {
              const y = chartConfig.padding.top + chartConfig.chartHeight - (i / 4) * chartConfig.chartHeight;
              return (
                <line
                  key={i}
                  x1={chartConfig.padding.left}
                  y1={y}
                  x2={chartConfig.width - chartConfig.padding.right}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth="1"
                  strokeDasharray={i === 0 ? "0" : "4,4"}
                  opacity={i === 0 ? 0.5 : 0.3}
                />
              );
            })}

            {/* Y-axis labels */}
            {yAxisLabels.map((label, i) => {
              const y = chartConfig.padding.top + chartConfig.chartHeight - (i / 4) * chartConfig.chartHeight;
              return (
                <text key={i} x={chartConfig.padding.left - 10} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10">
                  {label >= 1000 ? `${(label / 1000).toFixed(1)}k` : label}
                </text>
              );
            })}

            {/* X-axis labels */}
            {xAxisLabels.map(({ date, index }) => {
              const point = chartConfig.points[index];
              if (!point) return null;
              return (
                <text key={date} x={point.x} y={chartConfig.height - 10} textAnchor="middle" fill="#94a3b8" fontSize="10">
                  {formatDate(date)}
                </text>
              );
            })}

            {/* Area fill */}
            <path
              d={areaPath}
              fill="url(#trafficAreaGradient)"
              className={`transition-opacity duration-1000 ${isAnimated ? "opacity-100" : "opacity-0"}`}
            />

            {/* Unique visitors line */}
            <path
              d={uniquePath}
              fill="none"
              stroke="#34d399"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="6,4"
              opacity={0.7}
              className={`transition-opacity duration-1000 ${isAnimated ? "opacity-100" : "opacity-0"}`}
            />

            {/* Page views line */}
            <path
              d={viewsPath}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-opacity duration-1000 ${isAnimated ? "opacity-100" : "opacity-0"}`}
            />

            {/* Hover zones + tooltip */}
            {chartConfig.points.map((point, i) => (
              <g key={i}>
                <rect
                  x={point.x - 15}
                  y={chartConfig.padding.top}
                  width={30}
                  height={chartConfig.chartHeight}
                  fill="transparent"
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{ cursor: "crosshair" }}
                />
                {hoveredIndex === i && (
                  <>
                    <line
                      x1={point.x}
                      y1={chartConfig.padding.top}
                      x2={point.x}
                      y2={chartConfig.padding.top + chartConfig.chartHeight}
                      stroke="var(--primary)"
                      strokeWidth="1"
                      strokeDasharray="4,4"
                      opacity="0.4"
                    />
                    <circle cx={point.x} cy={point.y} r={5} fill="var(--primary)" stroke="white" strokeWidth={2} />
                    <circle
                      cx={chartConfig.uniquePoints[i].x}
                      cy={chartConfig.uniquePoints[i].y}
                      r={4}
                      fill="#34d399"
                      stroke="white"
                      strokeWidth={2}
                    />
                    <rect
                      x={point.x - 70}
                      y={Math.max(5, point.y - 70)}
                      width={140}
                      height={55}
                      rx={10}
                      fill="white"
                      stroke="#e2e8f0"
                      strokeWidth="1"
                    />
                    <text x={point.x} y={Math.max(5, point.y - 70) + 18} textAnchor="middle" fill="#475569" fontSize="11" fontWeight="600">
                      {formatDate(point.date)}
                    </text>
                    <text x={point.x - 30} y={Math.max(5, point.y - 70) + 36} textAnchor="start" fill="var(--primary)" fontSize="11" fontWeight="700">
                      {point.views.toLocaleString()} views
                    </text>
                    <text x={point.x - 30} y={Math.max(5, point.y - 70) + 50} textAnchor="start" fill="#34d399" fontSize="10">
                      {point.uniqueVisitors.toLocaleString()} unique
                    </text>
                  </>
                )}
              </g>
            ))}
          </svg>
        </div>
      )}

      {/* Section Breakdown + Conversion Funnel side by side */}
      <div className="grid md:grid-cols-2 gap-0 border-t border-slate-100">
        {/* Section Breakdown */}
        {data.bySection.length > 0 && (
          <div className="p-6 border-r border-slate-100">
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              Traffic by Section
            </h3>
            <div className="space-y-3">
              {data.bySection.map((section) => {
                const pct = totalSectionViews > 0 ? ((section.count / totalSectionViews) * 100).toFixed(1) : "0";
                const barWidth = (section.count / maxSectionCount) * 100;
                const color = SECTION_COLORS[section.section] || SECTION_COLORS.other;
                return (
                  <div key={section.section}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-slate-700 font-medium">
                        {SECTION_LABELS[section.section] || section.section}
                      </span>
                      <span className="text-xs text-slate-500">
                        {section.count.toLocaleString()} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${barWidth}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Conversion Funnel */}
        {data.conversionFunnel.length > 0 && (
          <div className="p-6">
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
              Conversion Funnel
            </h3>
            <div className="space-y-2">
              {data.conversionFunnel.map((step, i) => {
                const maxCount = data.conversionFunnel[0]?.count || 1;
                const barWidth = (step.count / maxCount) * 100;
                const prevCount = i > 0 ? data.conversionFunnel[i - 1].count : null;
                const convRate = prevCount && prevCount > 0
                  ? ((step.count / prevCount) * 100).toFixed(1)
                  : null;

                // Gradient from blue to green as funnel narrows
                const colors = ["#0A4B73", "#0e7490", "#059669", "#10b981"];
                const color = colors[i] || colors[colors.length - 1];

                return (
                  <div key={step.step}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: color }}>
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-700 font-medium">
                          {FUNNEL_LABELS[step.step] || step.step}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">
                          {step.count.toLocaleString()}
                        </span>
                        {convRate && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                            {convRate}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.max(barWidth, 2)}%`,
                          backgroundColor: color,
                          opacity: 0.8,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
