"use client";

import { BarsIcon } from "./icons";

// ===========================================================================
// Shared bits — empty / loading / error / icons / formatters
// ===========================================================================

export function EmptyState({ onLoad }: { onLoad: () => void }) {
  return (
    <div className="min-h-[300px] sm:min-h-[400px] bg-white rounded-2xl border border-slate-200 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-[var(--primary)]/10 flex items-center justify-center mx-auto mb-4">
          <BarsIcon className="w-8 h-8 text-[var(--primary-ink)]" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">Analytics Data</h3>
        <p className="text-slate-500 mb-6 max-w-xs text-sm">
          Click to load analytics. Data is not auto-loaded to minimize cost.
        </p>
        <button
          onClick={onLoad}
          className="px-6 py-3 bg-[var(--primary)] text-white rounded-xl hover:opacity-90 transition font-medium"
        >
          Load Analytics
        </button>
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
      <p className="text-red-600 font-medium">Error: {error}</p>
      <button
        onClick={onRetry}
        className="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition"
      >
        Retry
      </button>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="min-h-[300px] sm:min-h-[400px] bg-white rounded-2xl border border-slate-200 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[var(--primary)]/20 border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-500 text-sm">Loading analytics...</p>
      </div>
    </div>
  );
}
