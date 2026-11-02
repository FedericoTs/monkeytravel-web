"use client";

import type { ReactNode } from "react";
import { Clock, MapPin } from "lucide-react";
import type { ActivitySearchResult } from "@/hooks/useActivitySearch";
import { proxyImageUrl } from "@/lib/img/proxyUrl";
import { useActivityTypeLabel } from "@/lib/i18n/activity-type";
import { formatDuration } from "@/lib/datetime/duration";

/**
 * One search result in the activity pickers: its photo, name, type and
 * length. `children` adds lines under them; `trailing` sits at the end.
 */
export function ActivityResultRow({
  result,
  onSelect,
  children,
  trailing,
}: {
  result: ActivitySearchResult;
  onSelect: () => void;
  children?: ReactNode;
  trailing?: ReactNode;
}) {
  const typeLabel = useActivityTypeLabel();
  return (
    <button
      onClick={onSelect}
      className="w-full text-left p-3 rounded-lg hover:bg-slate-50 transition-colors border border-slate-100 group"
    >
      <div className="flex items-start gap-3">
        {result.image_url ? (
          <img
            src={proxyImageUrl(result.image_url) || result.image_url}
            alt={result.name}
            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
            // Each Google result photo is a paid download: only the ones scrolled to.
            loading="lazy"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-5 h-5 text-slate-500" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800 truncate">{result.name}</span>
            {result.source === "google" && (
              <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded">Google</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
            <span className="capitalize">{typeLabel(result.type)}</span>
            {result.duration_minutes ? (
              <>
                <span>•</span>
                <span className="flex items-center gap-0.5">
                  <Clock className="w-3 h-3" />
                  {formatDuration(result.duration_minutes)}
                </span>
              </>
            ) : null}
          </div>
          {children}
        </div>
        {trailing}
      </div>
    </button>
  );
}
