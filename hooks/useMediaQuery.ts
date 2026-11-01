import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept current as it changes. False on
 * the server and while hydrating.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia?.(query);
      if (!mql?.addEventListener) return () => {};
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    () => false
  );
}

/** Below Tailwind's `sm` breakpoint (640px). */
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 639px)");
}
