"use client";

import { useState, useMemo, useEffect, useRef } from "react";

interface DailyData {
  date: string;
  count: number;
  cumulative: number;
}

interface UserTrendData {
  daily: DailyData[];
  summary: {
    totalGrowth: number;
    avgDaily: number;
    bestDay: { date: string; count: number } | null;
    currentStreak: number;
  };
}

interface UserGrowthChartProps {
  data: UserTrendData;
}

type TimeRange = "7d" | "30d" | "90d";
type ViewMode = "cumulative" | "daily";

export default function UserGrowthChart({ data }: UserGrowthChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [viewMode, setViewMode] = useState<ViewMode>("cumulative");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isAnimated, setIsAnimated] = useState(false);
  const chartRef = useRef<SVGSVGElement>(null);

  // Filter data based on time range
  const filteredData = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    return data.daily.slice(-days);
  }, [data.daily, timeRange]);

  // Calculate chart dimensions and data points
  const chartConfig = useMemo(() => {
    const width = 800;
    const height = 280;
    const padding = { top: 40, right: 20, bottom: 50, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    if (filteredData.length === 0) {
      return { width, height, padding, chartWidth, chartHeight, points: [], maxValue: 0, minValue: 0 };
    }

    const values = filteredData.map((d) =>
      viewMode === "cumulative" ? d.cumulative : d.count
    );
    const maxValue = Math.max(...values, 1);
    const minValue = viewMode === "cumulative" ? Math.min(...values) : 0;
    const valueRange = maxValue - minValue || 1;

    const points = filteredData.map((d, i) => {
      const value = viewMode === "cumulative" ? d.cumulative : d.count;
      const x = padding.left + (i / (filteredData.length - 1 || 1)) * chartWidth;
      const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;
      return { x, y, value, date: d.date, count: d.count, cumulative: d.cumulative };
    });

    return { width, height, padding, chartWidth, chartHeight, points, maxValue, minValue };
  }, [filteredData, viewMode]);

  // Generate smooth bezier curve path
  const linePath = useMemo(() => {
    if (chartConfig.points.length < 2) return "";

    const points = chartConfig.points;
    let path = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
      const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
      path += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    return path;
  }, [chartConfig.points]);

  // Generate area path (for gradient fill)
  const areaPath = useMemo(() => {
    if (chartConfig.points.length < 2) return "";

    const { points, padding, chartHeight } = chartConfig;
    const bottomY = padding.top + chartHeight;

    let path = `M ${points[0].x} ${bottomY}`;
    path += ` L ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
      const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
      path += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    path += ` L ${points[points.length - 1].x} ${bottomY}`;
    path += " Z";

    return path;
  }, [chartConfig]);

  // Animation trigger
  useEffect(() => {
    setIsAnimated(false);
    const timer = setTimeout(() => setIsAnimated(true), 100);
    return () => clearTimeout(timer);
  }, [timeRange, viewMode]);

  // Format date for display
  const formatDate = (dateStr: string, short = false) => {
    const date = new Date(dateStr);
    if (short) {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  // Generate Y-axis labels
  const yAxisLabels = useMemo(() => {
    const { maxValue, minValue } = chartConfig;
    const range = maxValue - minValue;
    const step = Math.ceil(range / 4);
    const labels = [];
    for (let i = 0; i <= 4; i++) {
      labels.push(minValue + step * i);
    }
    return labels;
  }, [chartConfig]);

  // Generate X-axis labels (show fewer labels for clarity)
  const xAxisLabels = useMemo(() => {
    const step = Math.ceil(filteredData.length / 6);
    return filteredData
      .filter((_, i) => i % step === 0 || i === filteredData.length - 1)
      .map((d, _, arr) => ({
        date: d.date,
        index: filteredData.indexOf(d),
      }));
  }, [filteredData]);

  // Calculate stats for the selected period
  const periodStats = useMemo(() => {
    const totalNew = filteredData.reduce((sum, d) => sum + d.count, 0);
    const daysWithSignups = filteredData.filter((d) => d.count > 0).length;
    const avgDaily = filteredData.length > 0 ? totalNew / filteredData.length : 0;

    // Growth: compare first half to second half
    const half = Math.floor(filteredData.length / 2);
    const firstHalf = filteredData.slice(0, half).reduce((sum, d) => sum + d.count, 0);
    const secondHalf = filteredData.slice(half).reduce((sum, d) => sum + d.count, 0);
    const growth = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : secondHalf > 0 ? 100 : 0;

    return { totalNew, daysWithSignups, avgDaily: Math.round(avgDaily * 10) / 10, growth: Math.round(growth) };
  }, [filteredData]);

  if (data.daily.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
          User Growth Trend
        </h2>
        <div className="text-center py-16 text-slate-400">
          <svg
            className="w-16 h-16 mx-auto mb-4 opacity-40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
            />
          </svg>
          <p className="text-lg font-medium">No user data yet</p>
          <p className="text-sm mt-1">Growth chart will appear once users sign up</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-4 border-b border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/70 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </span>
              User Growth Trend
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {viewMode === "cumulative" ? "Total users over time" : "Daily new registrations"}
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode("cumulative")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                  viewMode === "cumulative"
                    ? "bg-white text-[var(--primary)] shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Cumulative
              </button>
              <button
                onClick={() => setViewMode("daily")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                  viewMode === "daily"
                    ? "bg-white text-[var(--primary)] shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Daily
              </button>
            </div>

            {/* Time Range Pills */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              {(["7d", "30d", "90d"] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                    timeRange === range
                      ? "bg-[var(--primary)] text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3 border border-slate-100">
            <div className="text-2xl font-bold text-[var(--foreground)]">
              {periodStats.totalNew}
            </div>
            <div className="text-xs text-slate-500">New Users</div>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl p-3 border border-emerald-100">
            <div className={`text-2xl font-bold ${periodStats.growth >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {periodStats.growth >= 0 ? "+" : ""}{periodStats.growth}%
            </div>
            <div className="text-xs text-emerald-600">Growth</div>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl p-3 border border-blue-100">
            <div className="text-2xl font-bold text-blue-600">
              {periodStats.avgDaily}
            </div>
            <div className="text-xs text-blue-600">Avg/Day</div>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 rounded-xl p-3 border border-amber-100">
            <div className="text-2xl font-bold text-amber-600">
              {data.summary.currentStreak}
            </div>
            <div className="text-xs text-amber-600">Day Streak</div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="p-6 pt-4">
        <div className="relative">
          <svg
            ref={chartRef}
            viewBox={`0 0 ${chartConfig.width} ${chartConfig.height}`}
            className="w-full h-auto"
            style={{ maxHeight: "320px" }}
          >
            {/* Definitions */}
            <defs>
              {/* Gradient for area fill */}
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
              </linearGradient>

              {/* Glow filter for line */}
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {/* Tooltip background */}
              <filter id="tooltipShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="8" floodOpacity="0.15" />
              </filter>
            </defs>

            {/* Grid lines */}
            <g className="text-slate-200">
              {yAxisLabels.map((label, i) => {
                const y = chartConfig.padding.top + chartConfig.chartHeight - (i / 4) * chartConfig.chartHeight;
                return (
                  <line
                    key={i}
                    x1={chartConfig.padding.left}
                    y1={y}
                    x2={chartConfig.width - chartConfig.padding.right}
                    y2={y}
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeDasharray={i === 0 ? "0" : "4,4"}
                    opacity={i === 0 ? 0.5 : 0.3}
                  />
                );
              })}
            </g>

            {/* Y-axis labels */}
            <g className="text-slate-400 text-xs">
              {yAxisLabels.map((label, i) => {
                const y = chartConfig.padding.top + chartConfig.chartHeight - (i / 4) * chartConfig.chartHeight;
                return (
                  <text
                    key={i}
                    x={chartConfig.padding.left - 10}
                    y={y + 4}
                    textAnchor="end"
                    fill="currentColor"
                    fontSize="11"
                  >
                    {label}
                  </text>
                );
              })}
            </g>

            {/* X-axis labels */}
            <g className="text-slate-400 text-xs">
              {xAxisLabels.map(({ date, index }) => {
                const point = chartConfig.points[index];
                if (!point) return null;
                return (
                  <text
                    key={date}
                    x={point.x}
                    y={chartConfig.height - 15}
                    textAnchor="middle"
                    fill="currentColor"
                    fontSize="10"
                  >
                    {formatDate(date, true)}
                  </text>
                );
              })}
            </g>

            {/* Area fill with animation */}
            <path
              d={areaPath}
              fill="url(#areaGradient)"
              className={`transition-opacity duration-1000 ${isAnimated ? "opacity-100" : "opacity-0"}`}
            />

            {/* Main line with animation */}
            <path
              d={linePath}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#glow)"
              className={`transition-all duration-1000 ${isAnimated ? "opacity-100" : "opacity-0"}`}
              style={{
                strokeDasharray: isAnimated ? "none" : "2000",
                strokeDashoffset: isAnimated ? "0" : "2000",
              }}
            />

            {/* Data points */}
            {chartConfig.points.map((point, i) => (
              <g key={i}>
                {/* Invisible hit area for hover */}
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

                {/* Vertical line on hover */}
                {hoveredIndex === i && (
                  <line
                    x1={point.x}
                    y1={chartConfig.padding.top}
                    x2={point.x}
                    y2={chartConfig.padding.top + chartConfig.chartHeight}
                    stroke="var(--primary)"
                    strokeWidth="1"
                    strokeDasharray="4,4"
                    opacity="0.5"
                  />
                )}

                {/* Point dot */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={hoveredIndex === i ? 7 : viewMode === "daily" && point.count > 0 ? 4 : 0}
                  fill={hoveredIndex === i ? "var(--primary)" : "white"}
                  stroke="var(--primary)"
                  strokeWidth={hoveredIndex === i ? 3 : 2}
                  className={`transition-all duration-200 ${isAnimated ? "opacity-100" : "opacity-0"}`}
                  style={{
                    filter: hoveredIndex === i ? "drop-shadow(0 0 8px var(--primary))" : "none",
                  }}
                />
              </g>
            ))}

            {/* Tooltip */}
            {hoveredIndex !== null && chartConfig.points[hoveredIndex] && (
              <g>
                <rect
                  x={chartConfig.points[hoveredIndex].x - 70}
                  y={Math.max(chartConfig.padding.top, chartConfig.points[hoveredIndex].y - 70)}
                  width={140}
                  height={60}
                  rx={12}
                  fill="white"
                  filter="url(#tooltipShadow)"
                  stroke="var(--primary)"
                  strokeWidth="1"
                  strokeOpacity="0.2"
                />
                <text
                  x={chartConfig.points[hoveredIndex].x}
                  y={Math.max(chartConfig.padding.top, chartConfig.points[hoveredIndex].y - 70) + 22}
                  textAnchor="middle"
                  fill="var(--foreground)"
                  fontSize="12"
                  fontWeight="600"
                >
                  {formatDate(chartConfig.points[hoveredIndex].date, true)}
                </text>
                <text
                  x={chartConfig.points[hoveredIndex].x}
                  y={Math.max(chartConfig.padding.top, chartConfig.points[hoveredIndex].y - 70) + 42}
                  textAnchor="middle"
                  fill="var(--primary)"
                  fontSize="14"
                  fontWeight="700"
                >
                  {viewMode === "cumulative"
                    ? `${chartConfig.points[hoveredIndex].cumulative} total`
                    : `+${chartConfig.points[hoveredIndex].count} new`}
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* Best Day Badge */}
        {data.summary.bestDay && (
          <div className="mt-4 flex items-center justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-50 to-amber-100/50 rounded-full border border-amber-200">
              <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span className="text-sm text-amber-700">
                Best day: <span className="font-semibold">{formatDate(data.summary.bestDay.date, true)}</span>
                {" "}with <span className="font-semibold">{data.summary.bestDay.count}</span> signups
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
