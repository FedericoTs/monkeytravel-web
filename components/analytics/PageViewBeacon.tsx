"use client";

/**
 * Records in-app navigations as page views.
 *
 * The middleware records the document load. It cannot see client-side
 * navigations for what they are: Next strips the Flight headers before
 * middleware runs, so an RSC navigation and a Link prefetch arrive identical
 * (lib/analytics/page-view-classifier.ts). The middleware therefore counts
 * navigations only, and this effect counts every pathname change after the
 * first, from the one place a prefetch can never reach: a prefetched page
 * runs no client effects.
 *
 * The first pathname is the document the middleware already counted, so it
 * is skipped. A query-only change (the wizard's router.replace) keeps the
 * pathname and sends nothing. sendBeacon survives a navigation that starts
 * right after; the fetch fallback covers browsers that block beacons. Every
 * failure is swallowed: this must never be visible to a visitor.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export default function PageViewBeacon() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (last.current === null || last.current === pathname) {
      last.current = pathname;
      return;
    }
    const from = last.current;
    last.current = pathname;

    const body = JSON.stringify({ path: pathname, from });
    try {
      if (typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon("/api/page-view", blob)) return;
      }
    } catch {
      // fall through to fetch
    }
    void fetch("/api/page-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
