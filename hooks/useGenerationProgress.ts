"use client";

import { useMemo, useState } from "react";
import type { SseDayData, SseOutlineData } from "@/lib/streaming/sse";
import type { GenerationProgress } from "@/lib/wizard/generation-attempt";

/**
 * A generation's plan as it streams in, for the wizard's GenerationProgress
 * view: a long trip's outline, the trip's length, and each day as it arrives
 * ("Day 3 of 7" and the plan itself) instead of fake-percentage phases.
 * `progress` is what one try reports into (attemptGeneration); each try
 * starts it over.
 */
export function useGenerationProgress(): {
  days: SseDayData[];
  outline: SseOutlineData["days"];
  totalDays: number;
  progress: GenerationProgress;
} {
  const [days, setDays] = useState<SseDayData[]>([]);
  const [outline, setOutline] = useState<SseOutlineData["days"]>([]);
  const [totalDays, setTotalDays] = useState(0);
  const progress = useMemo<GenerationProgress>(
    () => ({
      reset: () => {
        setDays([]);
        setOutline([]);
        setTotalDays(0);
      },
      total: setTotalDays,
      outline: setOutline,
      day: (day) => setDays((before) => [...before, day]),
    }),
    []
  );
  return { days, outline, totalDays, progress };
}
