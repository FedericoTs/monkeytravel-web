"use client";

import { useEffect, useState, useCallback } from "react";
import type { GoogleMetrics } from "@/app/api/admin/google-metrics/route";
import type { GoogleBillingData } from "@/app/api/admin/google-billing/route";

export default function GoogleMetricsDashboard() {
  const [metrics, setMetrics] = useState<GoogleMetrics | null>(null);
  const [billing, setBilling] = useState<GoogleBillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"usage" | "billing">("usage");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [metricsRes, billingRes] = await Promise.all([
        fetch("/api/admin/google-metrics"),
        fetch("/api/admin/google-billing"),
      ]);

      if (metricsRes.ok) {
        setMetrics(await metricsRes.json());
      }
      if (billingRes.ok) {
        setBilling(await billingRes.json());
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isConfigured = metrics?.configured || billing?.configured;

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Google Cloud Metrics
            </h2>
            <p className="text-sm text-slate-500">
              Real usage data directly from Google Cloud
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setActiveView("usage")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                activeView === "usage"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              API Usage
            </button>
            <button
              onClick={() => setActiveView("billing")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                activeView === "billing"
                  ? "bg-white text-green-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Billing
            </button>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Not Configured Banner */}
      {!isConfigured && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-amber-900">Google Cloud Integration Not Configured</h3>
              <p className="text-sm text-amber-700 mt-1 mb-4">
                To see real Google Cloud metrics and billing data, you need to set up the following:
              </p>
              <div className="space-y-4 text-sm">
                <div className="bg-white rounded-lg p-4 border border-amber-200">
                  <h4 className="font-medium text-slate-900 mb-2">Step 1: Create Service Account</h4>
                  <ol className="list-decimal list-inside text-slate-600 space-y-1">
                    <li>Go to Google Cloud Console &gt; IAM &gt; Service Accounts</li>
                    <li>Create a new service account</li>
                    <li>Grant roles: <code className="bg-slate-100 px-1 rounded">Monitoring Viewer</code> and <code className="bg-slate-100 px-1 rounded">BigQuery Data Viewer</code></li>
                    <li>Create and download a JSON key</li>
                  </ol>
                </div>
                <div className="bg-white rounded-lg p-4 border border-amber-200">
                  <h4 className="font-medium text-slate-900 mb-2">Step 2: Enable Billing Export</h4>
                  <ol className="list-decimal list-inside text-slate-600 space-y-1">
                    <li>Go to Billing &gt; Billing export</li>
                    <li>Create a BigQuery dataset for billing data</li>
                    <li>Enable &quot;Standard usage cost&quot; export</li>
                  </ol>
                </div>
                <div className="bg-white rounded-lg p-4 border border-amber-200">
                  <h4 className="font-medium text-slate-900 mb-2">Step 3: Add Environment Variables</h4>
                  <pre className="bg-slate-900 text-green-400 p-3 rounded text-xs overflow-x-auto">
{`# Base64 encode your service account JSON:
# cat service-account.json | base64

GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY=<base64-encoded-json>
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_BILLING_DATASET=billing_export
GOOGLE_CLOUD_BILLING_TABLE=gcp_billing_export_v1_XXXXXX`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && !metrics && !billing && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-500">Loading Google Cloud metrics...</span>
          </div>
        </div>
      )}

      {/* Discrepancy Alert */}
      {metrics?.comparison?.alert && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h4 className="font-semibold text-red-800">Usage Discrepancy Detected!</h4>
            <p className="text-sm text-red-700 mt-1">
              Google recorded <strong>{metrics.comparison.googleTotal.toLocaleString()}</strong> requests,
              but we only logged <strong>{metrics.comparison.loggedTotal.toLocaleString()}</strong> requests.
              That&apos;s a <strong>{metrics.comparison.discrepancyPercent}%</strong> discrepancy
              ({metrics.comparison.discrepancy.toLocaleString()} untracked requests).
            </p>
            <p className="text-xs text-red-600 mt-2">
              This could indicate API calls happening outside your tracked endpoints (like client-side calls or browser requests).
            </p>
          </div>
        </div>
      )}

      {/* Usage View */}
      {activeView === "usage" && metrics?.configured && (
        <div className="space-y-6">
          {/* Cost Summary with Free Tier - NEW */}
          {metrics.costSummary && (
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-sm font-semibold text-green-800">Monthly Cost Summary</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Gross Cost */}
                <div className="bg-white/60 rounded-xl p-4 border border-green-100">
                  <p className="text-xs font-medium text-slate-500 uppercase">Gross Cost</p>
                  <p className="text-2xl font-bold text-slate-700 mt-1">
                    ${metrics.costSummary.grossCost.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Before free tier</p>
                </div>

                {/* Free Credit */}
                <div className="bg-white/60 rounded-xl p-4 border border-green-100">
                  <p className="text-xs font-medium text-slate-500 uppercase">Free Credit</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">
                    -${metrics.costSummary.freeCredit.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Google&apos;s monthly credit</p>
                </div>

                {/* Net Cost */}
                <div className="bg-white/60 rounded-xl p-4 border border-green-100">
                  <p className="text-xs font-medium text-slate-500 uppercase">Est. Net Cost</p>
                  <p className={`text-2xl font-bold mt-1 ${
                    metrics.costSummary.netCost === 0 ? "text-green-600" : "text-amber-600"
                  }`}>
                    ${metrics.costSummary.netCost.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">After free tier</p>
                </div>

                {/* Status */}
                <div className={`rounded-xl p-4 border flex flex-col justify-center ${
                  metrics.costSummary.netCost === 0
                    ? "bg-green-100 border-green-200"
                    : "bg-amber-50 border-amber-200"
                }`}>
                  {metrics.costSummary.netCost === 0 ? (
                    <>
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm font-semibold text-green-800">Fully Covered</span>
                      </div>
                      <p className="text-xs text-green-700 mt-1">{metrics.costSummary.note}</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-sm font-semibold text-amber-800">Over Free Tier</span>
                      </div>
                      <p className="text-xs text-amber-700 mt-1">{metrics.costSummary.note}</p>
                    </>
                  )}
                </div>
              </div>

              <p className="text-xs text-green-700 mt-4 bg-white/50 rounded-lg px-3 py-2">
                <strong>Note:</strong> Google provides a $200/month free credit for Maps Platform APIs.
                The gross cost shown is calculated from request counts × standard pricing.
                Your actual Google bill will reflect the net cost after the free credit is applied.
              </p>
            </div>
          )}

          {/* Request Counts by Service */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Real API Request Counts (from Google)
            </h3>

            {metrics.requestCounts.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No API usage data found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 font-medium text-slate-500">Service</th>
                      <th className="text-right py-2 font-medium text-slate-500">Today</th>
                      <th className="text-right py-2 font-medium text-slate-500">7 Days</th>
                      <th className="text-right py-2 font-medium text-slate-500">30 Days</th>
                      <th className="text-right py-2 font-medium text-slate-500">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.requestCounts.map((service) => (
                      <tr key={service.service} className="border-b border-slate-50">
                        <td className="py-3 font-medium text-slate-700">{service.displayName}</td>
                        <td className="py-3 text-right text-slate-600">{service.today.toLocaleString()}</td>
                        <td className="py-3 text-right text-slate-600">{service.last7Days.toLocaleString()}</td>
                        <td className="py-3 text-right text-slate-600">{service.last30Days.toLocaleString()}</td>
                        <td className="py-3 text-right font-medium text-slate-900">${service.estimatedCost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td className="py-3 font-semibold text-slate-900">Total</td>
                      <td className="py-3 text-right font-semibold text-slate-900">
                        {metrics.requestCounts.reduce((sum, s) => sum + s.today, 0).toLocaleString()}
                      </td>
                      <td className="py-3 text-right font-semibold text-slate-900">
                        {metrics.requestCounts.reduce((sum, s) => sum + s.last7Days, 0).toLocaleString()}
                      </td>
                      <td className="py-3 text-right font-semibold text-slate-900">
                        {metrics.requestCounts.reduce((sum, s) => sum + s.last30Days, 0).toLocaleString()}
                      </td>
                      <td className="py-3 text-right font-bold text-blue-600">
                        ${metrics.requestCounts.reduce((sum, s) => sum + s.estimatedCost, 0).toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Comparison Card */}
          {metrics.comparison && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">
                Logged vs Google Actual (Last 30 Days)
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-blue-50 rounded-xl">
                  <div className="text-2xl font-bold text-blue-700">
                    {metrics.comparison.googleTotal.toLocaleString()}
                  </div>
                  <div className="text-sm text-blue-600">Google Recorded</div>
                </div>
                <div className="text-center p-4 bg-slate-50 rounded-xl">
                  <div className="text-2xl font-bold text-slate-700">
                    {metrics.comparison.loggedTotal.toLocaleString()}
                  </div>
                  <div className="text-sm text-slate-600">We Logged</div>
                </div>
                <div className={`text-center p-4 rounded-xl ${
                  metrics.comparison.discrepancy > 0 ? "bg-red-50" : "bg-green-50"
                }`}>
                  <div className={`text-2xl font-bold ${
                    metrics.comparison.discrepancy > 0 ? "text-red-700" : "text-green-700"
                  }`}>
                    {metrics.comparison.discrepancy > 0 ? "+" : ""}{metrics.comparison.discrepancy.toLocaleString()}
                  </div>
                  <div className={`text-sm ${
                    metrics.comparison.discrepancy > 0 ? "text-red-600" : "text-green-600"
                  }`}>
                    Discrepancy ({metrics.comparison.discrepancyPercent}%)
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Daily Usage Trend */}
          {metrics.dailyUsage.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Daily Request Trend</h3>
              <div className="h-48 flex items-end gap-1">
                {metrics.dailyUsage.slice(-30).map((day, i) => {
                  const maxRequests = Math.max(...metrics.dailyUsage.map(d => d.totalRequests), 1);
                  const height = (day.totalRequests / maxRequests) * 100;
                  const isToday = i === metrics.dailyUsage.length - 1;

                  return (
                    <div
                      key={day.date}
                      className="flex-1 flex flex-col items-center group relative"
                    >
                      <div
                        className={`w-full rounded-t transition-all ${
                          isToday ? "bg-blue-500" : "bg-blue-300 hover:bg-blue-400"
                        }`}
                        style={{ height: `${Math.max(height, 2)}%` }}
                      />
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                        <div className="bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                          {day.date}: {day.totalRequests.toLocaleString()} req (~${day.estimatedCost.toFixed(2)})
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-slate-400 mt-2">
                <span>{metrics.dailyUsage[0]?.date}</span>
                <span>Today</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Billing View */}
      {activeView === "billing" && billing?.configured && (
        <div className="space-y-6">
          {/* Cost Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <BillingCard
              label="Today"
              value={`$${billing.summary.todayCostUsd.toFixed(2)}`}
              color="blue"
            />
            <BillingCard
              label="Last 7 Days"
              value={`$${billing.summary.last7DaysCostUsd.toFixed(2)}`}
              color="green"
            />
            <BillingCard
              label="This Month"
              value={`$${billing.summary.currentMonthCostUsd.toFixed(2)}`}
              color="purple"
            />
            <BillingCard
              label="Last Month"
              value={`$${billing.summary.previousMonthCostUsd.toFixed(2)}`}
              color="slate"
            />
          </div>

          {/* Cumulative Cost Chart */}
          {billing.cumulativeCosts.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">
                Cumulative Cost Trend (30 Days)
              </h3>
              <div className="h-48 relative">
                <svg className="w-full h-full" preserveAspectRatio="none">
                  {/* Area fill */}
                  <defs>
                    <linearGradient id="costGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
                    </linearGradient>
                  </defs>
                  <path
                    d={generateAreaPath(billing.cumulativeCosts)}
                    fill="url(#costGradient)"
                  />
                  <path
                    d={generateLinePath(billing.cumulativeCosts)}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2"
                  />
                </svg>
                {/* Y-axis labels */}
                <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-slate-400">
                  <span>${Math.max(...billing.cumulativeCosts.map(c => c.cumulativeTotal)).toFixed(0)}</span>
                  <span>$0</span>
                </div>
              </div>
              <div className="flex justify-between text-xs text-slate-400 mt-2">
                <span>{billing.cumulativeCosts[0]?.date}</span>
                <span>Today</span>
              </div>
            </div>
          )}

          {/* Cost by Service */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Cost by Service</h3>
            {billing.byService.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No billing data</p>
            ) : (
              <div className="space-y-3">
                {billing.byService.map((service) => (
                  <div key={service.service} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{service.description}</span>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-900">
                        ${service.totalCost.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-400">
                        ${service.last7DaysCost.toFixed(2)} last 7d
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SKU Breakdown */}
          {billing.bySkU.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Top SKUs by Cost</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 font-medium text-slate-500">SKU</th>
                      <th className="text-right py-2 font-medium text-slate-500">Usage</th>
                      <th className="text-right py-2 font-medium text-slate-500">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.bySkU.slice(0, 10).map((sku, i) => (
                      <tr key={`${sku.sku}-${i}`} className="border-b border-slate-50">
                        <td className="py-2">
                          <div className="font-medium text-slate-700 truncate max-w-[200px]" title={sku.description}>
                            {sku.description}
                          </div>
                          <div className="text-xs text-slate-400">{sku.service}</div>
                        </td>
                        <td className="py-2 text-right text-slate-600">
                          {sku.usage.toLocaleString()} {sku.unit}
                        </td>
                        <td className="py-2 text-right font-medium text-slate-900">
                          ${sku.cost.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Show not configured message for billing view */}
      {activeView === "billing" && !billing?.configured && !loading && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
          <p className="text-slate-500">BigQuery billing export not configured yet.</p>
        </div>
      )}

      {/* Show not configured message for usage view */}
      {activeView === "usage" && !metrics?.configured && !loading && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
          <p className="text-slate-500">Cloud Monitoring not configured yet.</p>
        </div>
      )}
    </div>
  );
}

function BillingCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    green: "bg-green-50 border-green-200 text-green-900",
    purple: "bg-purple-50 border-purple-200 text-purple-900",
    slate: "bg-slate-50 border-slate-200 text-slate-900",
  };

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium text-slate-500 uppercase">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function generateLinePath(data: { date: string; cumulativeTotal: number }[]): string {
  if (data.length === 0) return "";

  const maxValue = Math.max(...data.map(d => d.cumulativeTotal), 1);
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - (d.cumulativeTotal / maxValue) * 100;
    return `${x},${y}`;
  });

  return `M ${points.join(" L ")}`;
}

function generateAreaPath(data: { date: string; cumulativeTotal: number }[]): string {
  if (data.length === 0) return "";

  const maxValue = Math.max(...data.map(d => d.cumulativeTotal), 1);
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - (d.cumulativeTotal / maxValue) * 100;
    return `${x},${y}`;
  });

  return `M 0,100 L ${points.join(" L ")} L 100,100 Z`;
}
