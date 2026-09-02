"use client";

import { useEffect, type RefObject } from "react";

/**
 * Publish an element's rendered height as a CSS custom property on :root.
 *
 * Built for the wizard's fixed footer: the cookie banner is a global,
 * position:fixed component that knows nothing about the page it lands on, so
 * on /trips/new it can sit at `bottom: var(--mt-footer-h)` and never cover
 * the Continue button — without either component importing the other, and
 * without reserving space (a reservation would be a layout shift the moment
 * the banner mounts, 1.5s after load, on a page with a CLS history).
 *
 * The property is removed on unmount so a later page never inherits a stale
 * value. ResizeObserver-less browsers simply never set it; consumers must
 * carry a fallback in the var() call.
 */
export function useCssVarHeight(ref: RefObject<HTMLElement | null>, name: `--${string}`): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty(name, `${Math.round(el.getBoundingClientRect().height)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(name);
    };
  }, [ref, name]);
}
