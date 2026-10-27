"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the page's server data every minute, so the numbers stay live. */
export function AutoRefresh({ updatedAt, everySeconds = 60 }: { updatedAt: string; everySeconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everySeconds * 1000);
    return () => clearInterval(timer);
  }, [router, everySeconds]);
  return (
    <p className="inline-flex items-center gap-2 text-xs text-slate-500" aria-live="polite">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" aria-hidden="true" />
      Live · updated {updatedAt}
    </p>
  );
}
