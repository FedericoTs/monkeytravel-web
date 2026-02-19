/**
 * Lazy Loading Utilities
 *
 * Provides optimized dynamic imports for heavy components:
 * - TripMap (~45KB - @react-google-maps/api)
 * - Admin Dashboard tabs (~50-60KB combined)
 * - PDF Export utilities (~75KB - jspdf + html2canvas)
 *
 * Benefits:
 * - Reduces initial bundle size by 150-200KB
 * - Components load on-demand when needed
 * - Skeleton loaders maintain layout during load
 * - Preloading hints for anticipated navigation
 *
 * @example
 * // In a component
 * import { LazyTripMap, preloadTripMap } from '@/lib/lazy';
 *
 * // Preload when user hovers over map tab
 * onMouseEnter={preloadTripMap}
 *
 * // Use the lazy component
 * <LazyTripMap days={days} destination={destination} />
 */

"use client";

import dynamic from "next/dynamic";
import { Suspense, type ComponentType } from "react";

// ============================================================================
// Loading Skeletons
// ============================================================================

/**
 * Map loading skeleton with pulsing animation
 */
export function MapLoadingSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`relative bg-slate-100 rounded-xl overflow-hidden ${className}`}>
      <div className="absolute inset-0 animate-pulse">
        <div className="h-full w-full bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center mx-auto mb-3 shadow-sm">
            <svg
              className="w-6 h-6 text-slate-400 animate-pulse"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
          </div>
          <p className="text-sm text-slate-500">Loading map...</p>
        </div>
      </div>
    </div>
  );
}

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
// Lazy Components - TripMap
// ============================================================================

/**
 * Dynamically imported TripMap component
 * Saves ~45KB from initial bundle
 */
export const LazyTripMap = dynamic(
  () => import("@/components/TripMap").then((mod) => mod.default),
  {
    loading: () => <MapLoadingSkeleton className="h-[500px]" />,
    ssr: false, // Google Maps requires client-side only
  }
);

// Preload function for anticipatory loading
let tripMapPreloaded = false;
export function preloadTripMap(): void {
  if (tripMapPreloaded) return;
  tripMapPreloaded = true;
  import("@/components/TripMap");
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
 * PDF export loaded only when user initiates export
 * Saves ~75KB from initial bundle
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

// ============================================================================
// Generic Lazy Wrapper
// ============================================================================

interface LazyWrapperProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Suspense wrapper with default fallback
 */
export function LazyWrapper({ children, fallback }: LazyWrapperProps) {
  return (
    <Suspense fallback={fallback || <AdminTabSkeleton />}>
      {children}
    </Suspense>
  );
}

/**
 * Helper to create lazy component with consistent loading state
 */
export function createLazyComponent<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  loadingComponent?: React.ReactNode
) {
  return dynamic(importFn, {
    loading: () => <>{loadingComponent || <AdminTabSkeleton />}</>,
    ssr: false,
  });
}
