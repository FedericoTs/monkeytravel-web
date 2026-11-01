/**
 * Lazy Loading Utilities
 *
 * Dynamic imports for heavy code that loads on demand:
 * - the Admin Dashboard tabs, with skeletons that hold the layout while a
 *   tab's chunk loads;
 * - the PDF export (jspdf + html2canvas).
 *
 * @example
 * import { LazyGrowthDashboard, preloadAdminTab } from '@/lib/lazy';
 *
 * // Fetch the tab's chunk when the user hovers over it
 * onMouseEnter={() => preloadAdminTab("growth")}
 *
 * <LazyGrowthDashboard />
 */

"use client";

import dynamic from "next/dynamic";

// ============================================================================
// Loading Skeletons
// ============================================================================

/**
 * Admin tab loading skeleton
 */
export function AdminTabSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-slate-200 rounded-lg" />
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="space-y-4">
          <div className="h-4 bg-slate-200 rounded w-3/4" />
          <div className="h-4 bg-slate-200 rounded w-1/2" />
          <div className="h-32 bg-slate-100 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/**
 * Chart loading skeleton
 */
export function ChartLoadingSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="h-6 w-32 bg-slate-200 rounded mb-4 animate-pulse" />
      <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />
    </div>
  );
}

// ============================================================================
// Lazy Components - Admin Dashboard Tabs
// ============================================================================

/**
 * Admin components loaded on-demand per tab
 */
export const LazyUserGrowthChart = dynamic(
  () => import("@/components/admin/UserGrowthChart"),
  {
    loading: () => <ChartLoadingSkeleton />,
    ssr: false,
  }
);

export const LazyTrafficOverview = dynamic(
  () => import("@/components/admin/TrafficOverview"),
  {
    loading: () => <ChartLoadingSkeleton />,
    ssr: false,
  }
);

export const LazyAcquisitionEngagement = dynamic(
  () => import("@/components/admin/AcquisitionEngagement"),
  {
    loading: () => <ChartLoadingSkeleton />,
    ssr: false,
  }
);

export const LazyCostCommandCenter = dynamic(
  () => import("@/components/admin/CostCommandCenter"),
  {
    loading: () => <AdminTabSkeleton />,
    ssr: false,
  }
);

export const LazyAccessControl = dynamic(
  () => import("@/components/admin/AccessControl"),
  {
    loading: () => <AdminTabSkeleton />,
    ssr: false,
  }
);

export const LazyApiControlPanel = dynamic(
  () => import("@/components/admin/ApiControlPanel"),
  {
    loading: () => <AdminTabSkeleton />,
    ssr: false,
  }
);

export const LazyPromptEditor = dynamic(
  () => import("@/components/admin/PromptEditor"),
  {
    loading: () => <AdminTabSkeleton />,
    ssr: false,
  }
);

export const LazyAccessCodesManager = dynamic(
  () => import("@/components/admin/AccessCodesManager"),
  {
    loading: () => <AdminTabSkeleton />,
    ssr: false,
  }
);

export const LazyGrowthDashboard = dynamic(
  () => import("@/components/admin/GrowthDashboard"),
  {
    loading: () => <AdminTabSkeleton />,
    ssr: false,
  }
);

// ============================================================================
// Lazy Components - PDF Export
// ============================================================================

/**
 * PDF export, loaded only when the user starts an export.
 */
export const lazyLoadPdfExport = () =>
  import("@/lib/export/pdf").then((mod) => mod.generateTripPDF);

// ============================================================================
// Preload Utilities
// ============================================================================

/**
 * Preload admin components for a specific tab
 */
export function preloadAdminTab(tab: string): void {
  switch (tab) {
    case "growth":
      import("@/components/admin/GrowthDashboard");
      break;
    case "costs":
      import("@/components/admin/CostCommandCenter");
      break;
    case "apis":
      import("@/components/admin/ApiControlPanel");
      break;
    case "prompts":
      import("@/components/admin/PromptEditor");
      break;
    case "access":
      import("@/components/admin/AccessControl");
      break;
    case "codes":
      import("@/components/admin/AccessCodesManager");
      break;
  }
}
