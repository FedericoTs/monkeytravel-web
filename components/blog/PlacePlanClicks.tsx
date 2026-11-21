"use client";

import { useEffect } from "react";

/**
 * Counts presses on the "Plan this trip for <month>" links an article's body
 * carries (lib/blog/place-plan-links.ts), in the site's own count, the same for
 * every visitor: the links are plain HTML, so one listener reads them all.
 */
export default function PlacePlanClicks() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLElement>("a[data-plan-place]") : null;
      if (!link) return;
      try {
        void fetch("/api/funnel-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_type: "plan_own_clicked", destination: link.dataset.planPlace, surface: "article_place" }),
          keepalive: true,
        });
      } catch {
        // Nothing to do: the reader is already on their way.
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
