"use client";

/**
 * One-shot client island that bootstraps native + offline plumbing.
 *
 * Mounted near the root of the layout so it runs once per app launch.
 * Specifically:
 *   - Registers the service worker (lib/sw/register.ts) — only on
 *     /trips/* paths and only in production
 *   - Installs the Android back-button handler (lib/native/back-button.ts)
 *     — no-op outside the Capacitor shell
 *
 * Renders nothing. Errors are logged but never thrown.
 */

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/sw/register";
import { installBackButtonHandler } from "@/lib/native/back-button";

export default function NativeBoot() {
  useEffect(() => {
    // On native (Capacitor) the SW would shadow the live-URL strategy.
    // Purge any caches a previous build may have left behind so the
    // WebView always hits the network on cold launch.
    const cap = (window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.() && "caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => undefined);
    }

    // SW registration — fire-and-forget, helper is self-gated.
    registerServiceWorker().catch(() => undefined);

    // Back-button — returns an unsubscribe function we honour on unmount.
    let unsubscribe: (() => void) | null = null;
    installBackButtonHandler()
      .then((unsub) => {
        unsubscribe = unsub;
      })
      .catch(() => undefined);

    return () => {
      unsubscribe?.();
    };
  }, []);

  return null;
}
