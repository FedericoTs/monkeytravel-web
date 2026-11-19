"use client";

import { useEffect, useState } from "react";
import type { RouteStop } from "@/components/trips/MultiCityRouteBuilder";
import { fetchRouteOffer, ROUTE_TIMEOUT_MS } from "@/lib/wizard/route-offer";

/** A pause after the last change before asking, so typing a place or moving dates asks once. */
const SETTLE_MS = 1000;

/**
 * The route step 1 offers for `ask` (lib/wizard/route-offer.ts routeOfferAsk),
 * asked once the place and dates have settled: two to five bases, or null. An
 * answer is kept for the visit, so going back to a place and length asked
 * before shows it again without asking.
 */
export function useRouteOffer(ask: { place: string; days: number } | null, startDate: string, locale: string): RouteStop[] | null {
  // The season changes the route, so the month is part of what was asked.
  const key = ask ? `${ask.place.toLowerCase()}|${ask.days}|${startDate.slice(0, 7)}|${locale}` : null;
  const [answers, setAnswers] = useState<Record<string, RouteStop[]>>({});
  const asked = key !== null && key in answers;

  useEffect(() => {
    if (!ask || key === null || asked) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settle = setTimeout(() => {
      timeout = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
      void fetchRouteOffer({ ...ask, startDate, locale }, controller.signal).then((route) => {
        clearTimeout(timeout);
        if (!controller.signal.aborted) setAnswers((a) => ({ ...a, [key]: route }));
      });
    }, SETTLE_MS);
    return () => {
      clearTimeout(settle);
      clearTimeout(timeout);
      controller.abort();
    };
    // `key` stands for the place, the days, the month and the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, asked]);

  const route = key !== null ? answers[key] : undefined;
  return route && route.length >= 2 ? route : null;
}
