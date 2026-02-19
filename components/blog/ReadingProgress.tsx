"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { trackContentInteraction } from "@/lib/analytics";

interface ReadingProgressProps {
  slug?: string;
}

const MILESTONES = [25, 50, 75, 100] as const;

export default function ReadingProgress({ slug }: ReadingProgressProps) {
  const [progress, setProgress] = useState(0);
  const firedMilestones = useRef<Set<number>>(new Set());

  const checkMilestones = useCallback(
    (pct: number) => {
      if (!slug) return;
      for (const milestone of MILESTONES) {
        if (pct >= milestone && !firedMilestones.current.has(milestone)) {
          firedMilestones.current.add(milestone);
          trackContentInteraction({
            action: "read_milestone",
            content_group: "blog",
            content_id: slug,
            percentage: milestone,
          });
        }
      }
    },
    [slug]
  );

  useEffect(() => {
    let raf: number;

    function updateProgress() {
      const scrollTop = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const pct =
        docHeight > 0 ? Math.min((scrollTop / docHeight) * 100, 100) : 0;
      setProgress(pct);
      checkMilestones(pct);
    }

    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateProgress);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    updateProgress();

    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [checkMilestones]);

  return (
    <div
      className="fixed top-0 left-0 h-[3px] bg-[var(--accent)] z-50 transition-[width] duration-150"
      style={{ width: `${progress}%` }}
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
    />
  );
}
