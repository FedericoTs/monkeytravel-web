import { type ReactNode } from "react";

// ============================================
// COLLAPSIBLE SECTION WRAPPER
// ============================================
export function Collapsible({
  title,
  badge,
  defaultOpen,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="bg-white rounded-2xl border border-slate-200 overflow-hidden group">
      <summary className="cursor-pointer select-none px-6 py-4 flex items-center justify-between hover:bg-slate-50">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-[var(--foreground)]">{title}</span>
          {badge && (
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">
              {badge}
            </span>
          )}
        </div>
        <svg
          className="w-5 h-5 text-slate-500 transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-1 pb-1">{children}</div>
    </details>
  );
}
