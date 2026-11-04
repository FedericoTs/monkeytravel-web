"use client";

import { useEffect, type RefObject } from "react";
import { reportGenerationLeft, type GenerationReport } from "@/lib/wizard/generation-reports";

/**
 * A generation whose page was hidden, closed or left for another page before
 * its plan came back is reported (reportGenerationLeft), once per generation.
 * `inFlight` holds the generation under way, null between them.
 */
export function useGenerationLeft(inFlight: RefObject<GenerationReport | null>): void {
  useEffect(() => {
    const reported = new WeakSet<GenerationReport>();
    const left = () => {
      const g = inFlight.current;
      if (!g || reported.has(g)) return;
      reported.add(g);
      reportGenerationLeft(g);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") left();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", left);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", left);
      // The wizard unmounted mid-wait: another page of the app.
      left();
    };
  }, [inFlight]);
}
