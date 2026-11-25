import { useEffect } from "react";

/**
 * Takes the page to the top when a plan arrives: a generation finished, a draft brought back, another kept plan
 * swapped in (each of the last two also moves `planNumber`). The same plan changing (its photos found, an
 * assistant's edit) replaces the plan object but leaves the reader where they are in it.
 */
export function useScrollTopOnNewPlan(plan: unknown, planNumber: number): void {
  const hasPlan = Boolean(plan);
  useEffect(() => {
    if (hasPlan) window.scrollTo({ top: 0, behavior: "instant" });
  }, [hasPlan, planNumber]);
}
