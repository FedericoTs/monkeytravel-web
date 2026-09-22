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
 *
 * `enabled` exists because the deps are [ref, name], both stable, so the
 * effect runs exactly once at mount and bails on a null ref. A bar that only
 * appears after 400px of scroll (StickyBlogCta returns null until then) would
 * therefore never publish anything. Pass the visibility flag and the effect
 * re-runs when the element actually exists.
 *
 * The removal is value-guarded: two fixed bars can be mounted across a route
 * change, and an unguarded cleanup lets the OUTGOING one delete a property
 * the incoming one has already set — leaving whatever reads it sitting on
 * its fallback, which is how a consent bar ends up on top of a nav.
 */
export function useCssVarHeight(
  ref: RefObject<HTMLElement | null>,
  name: `--${string}`,
  enabled: boolean = true
): void {
  useEffect(() => {
    const el = enabled ? ref.current : null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    let last = "";
    const apply = () => {
      last = `${Math.round(el.getBoundingClientRect().height)}px`;
      root.style.setProperty(name, last);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (root.style.getPropertyValue(name) === last) root.style.removeProperty(name);
    };
  }, [ref, name, enabled]);
}
