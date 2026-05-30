/**
 * Deep link listener for the Capacitor native shell.
 *
 * Wires the @capacitor/app `appUrlOpen` event to in-WebView navigation
 * so that:
 *   - Universal Links / App Links tapped from another app land on the
 *     correct route INSIDE our WebView (not via a cold load that would
 *     restart the JS bundle, lose state, and flash a splash).
 *   - Push notification taps with a `data.url` payload route to the
 *     right trip/explore/profile page (this becomes load-bearing when
 *     B1 push ships — see MOBILE_CONVERSION_PLAN.md).
 *   - OAuth provider redirects (Apple, Google) that bounce back into
 *     the app via Universal Link still reach /auth/callback so the
 *     existing PKCE exchange runs.
 *
 * Web bundle impact: zero. Dynamic-import gates @capacitor/app behind
 * `isNativePlatform()`, mirroring back-button.ts and haptics.ts.
 *
 * Why we don't ship a heavier router (Branch.io, etc):
 *   - We OWN the universal-link domain (monkeytravel.app) so first-
 *     party in-app routing is enough.
 *   - Branch + AppsFlyer would add IDFA-pressure on iOS 14.5+ (ATT
 *     compliance — see docs/legal/app-privacy-label.md).
 *   - Our URL space is already routable; we just need to "go there
 *     without a full app restart."
 *
 * Behavior:
 *   - Strips the canonical host(s) so "https://monkeytravel.app/trips/x"
 *     becomes "/trips/x".
 *   - Custom URL scheme support (e.g. "monkeytravel://trips/x") is wired
 *     defensively for when the iOS Info.plist registers the scheme —
 *     today it's a no-op because no scheme is registered.
 *   - Skips when the resolved path matches the current location (no
 *     redundant re-navigation that would re-mount the page).
 *   - Uses window.location.assign for now instead of a Next router push
 *     because this module loads OUTSIDE React tree (no hook context).
 *     Next.js intercepts in-app navigations to the same origin and
 *     converts to client-side transition — assign() to a same-origin
 *     URL ends up as soft navigation in App Router.
 *
 * Logging is intentionally verbose because deep-link bugs are
 * notoriously hard to reproduce without a real device — readable
 * console output during TestFlight saves debugging cycles later.
 */

// The Universal-Link host(s) we recognize as "this is us, route
// in-app." Add staging/preview domains here if they ever serve
// production-equivalent traffic that needs to in-app-route.
const APP_HOSTS = new Set(["monkeytravel.app"]);

// Custom URL scheme — defensive. If/when iOS Info.plist + Android
// AndroidManifest register the scheme, deep links like
// "monkeytravel://trips/abc" route correctly. Today they're unused.
const APP_SCHEMES = new Set(["monkeytravel:", "capacitor:"]);

/**
 * Install the native deep-link listener. Returns an unsubscribe
 * function that removes the listener on unmount.
 *
 * No-op outside the Capacitor shell — returns a noop unsubscribe so
 * callers can use the same useEffect cleanup shape.
 */
export async function installDeepLinkHandler(): Promise<() => void> {
  if (typeof window === "undefined") return () => undefined;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  if (!cap?.isNativePlatform?.()) return () => undefined;

  let listenerHandle: { remove: () => Promise<void> } | null = null;

  try {
    const { App } = await import("@capacitor/app");
    listenerHandle = await App.addListener("appUrlOpen", (event) => {
      try {
        const targetPath = resolveInAppPath(event.url);
        if (!targetPath) {
          // eslint-disable-next-line no-console
          console.log(
            "[deep-links] external/unrecognized URL — Capacitor will handle:",
            event.url
          );
          return;
        }

        // No-op if we're already on the target — Capacitor sometimes
        // re-fires appUrlOpen on app resume with the original launch URL.
        const currentPath = window.location.pathname + window.location.search;
        if (currentPath === targetPath) {
          // eslint-disable-next-line no-console
          console.log("[deep-links] already at target, ignoring:", targetPath);
          return;
        }

        // eslint-disable-next-line no-console
        console.log("[deep-links] routing in-WebView to:", targetPath);

        // Same-origin navigation. Next.js App Router's link interceptor
        // converts this to a soft transition (no full page reload, no
        // bundle re-execute, no splash).
        window.location.assign(targetPath);
      } catch (err) {
        // Never let a routing bug bubble up and tear down the listener
        // — better to log and stay subscribed for the next event.
        // eslint-disable-next-line no-console
        console.error("[deep-links] handler threw:", err);
      }
    });
  } catch (err) {
    // @capacitor/app missing or failed to load. Shouldn't happen in
    // the native shell but defensive against partial install states.
    // eslint-disable-next-line no-console
    console.warn("[deep-links] failed to register appUrlOpen listener:", err);
  }

  return () => {
    listenerHandle?.remove().catch(() => undefined);
  };
}

/**
 * Parse a deep-link URL and return the in-app path to navigate to.
 * Returns null if the URL doesn't belong to our app (we let Capacitor
 * handle external URLs — e.g. mailto:, tel:).
 *
 * Exported for unit testing.
 */
export function resolveInAppPath(rawUrl: string): string | null {
  if (!rawUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  // Universal Link path: protocol is https + host is one of ours.
  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    if (!APP_HOSTS.has(parsed.host)) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  // Custom URL scheme path (e.g. "monkeytravel://trips/abc?ref=push").
  // The "host" of a custom-scheme URL is the path's first segment, so
  // "monkeytravel://trips/abc" parses as host=trips, pathname=/abc.
  // Reassemble: "/{host}{pathname}".
  if (APP_SCHEMES.has(parsed.protocol)) {
    const path = `/${parsed.host}${parsed.pathname}`;
    // Collapse accidental double-slashes from edge cases like
    // "monkeytravel:///trips/abc" → host="" pathname="/trips/abc".
    const normalized = path.replace(/\/+/g, "/");
    return `${normalized}${parsed.search}${parsed.hash}`;
  }

  return null;
}
