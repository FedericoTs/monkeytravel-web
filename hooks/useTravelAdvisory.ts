"use client";

import { useEffect, useState } from "react";
import { advisoryCountry } from "@/lib/advisories/country";
import type { TravelAdvisory } from "@/lib/advisories/fcdo";

/**
 * The UK's travel advice for a trip's destination, asked for once the page has
 * drawn. Null while it asks, when the UK publishes nothing for the country, when
 * the route can't answer, and at the lowest level, where there is nothing to
 * read first. Only the country is sent, never the trip.
 */
export function useTravelAdvisory(destination: string): TravelAdvisory | null {
  const [advisory, setAdvisory] = useState<TravelAdvisory | null>(null);
  const country = advisoryCountry(destination);
  useEffect(() => {
    if (!country) return;
    const ctrl = new AbortController();
    fetch(`/api/advisories/${encodeURIComponent(country)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { advisory: null }))
      .then((data: { advisory: TravelAdvisory | null }) => {
        setAdvisory(data.advisory && data.advisory.level !== "low" ? data.advisory : null);
      })
      .catch((err) => {
        // An abort on unmount is expected.
        if (err instanceof Error && err.name !== "AbortError") {
          console.warn("[useTravelAdvisory] fetch failed", err.message);
        }
      });
    return () => ctrl.abort();
  }, [country]);
  return advisory;
}

/**
 * Advice against travel to the whole country, all travel or all but essential
 * travel: the one kind the trip page shows above the plan, as it changes
 * whether to go.
 */
export function coversWholeCountry(advisory: TravelAdvisory | null): boolean {
  return advisory?.advice === "all_whole" || advisory?.advice === "essential_whole";
}
