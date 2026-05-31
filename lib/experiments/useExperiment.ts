"use client";
import { useEffect, useState } from "react";

/**
 * Pull a PostHog feature flag variant. Returns "control" as the SSR-safe
 * default; updates after PostHog hydrates. Cache the variant in state so it
 * doesn't flicker across re-renders.
 *
 * @example
 *   const variant = useExperiment("wizard-cta-copy"); // "control" | "variant_a" | "variant_b"
 *   return <button>{variant === "variant_a" ? "Plan free" : "Start free trip"}</button>;
 */
export function useExperiment(flagKey: string): string {
  const [variant, setVariant] = useState<string>("control");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: posthog } = await import("posthog-js");
        if (!posthog?.__loaded) return;
        const v = posthog.getFeatureFlag(flagKey);
        if (cancelled) return;
        setVariant(typeof v === "string" ? v : v ? "variant_a" : "control");
      } catch {
        /* PostHog not ready or not installed; stay on control */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flagKey]);

  return variant;
}

/**
 * Server-side equivalent — for a/b in RSCs. Reads the variant from a
 * cookie that PostHog mirrors (if NEXT_PUBLIC_POSTHOG_BOOTSTRAP_FLAGS=1)
 * or returns "control" if no cookie. Sync, no fetch.
 */
export function getExperimentFromCookies(
  cookies: { get(name: string): { value: string } | undefined },
  flagKey: string,
): string {
  const v = cookies.get(`ph_${flagKey}`)?.value;
  return v || "control";
}
