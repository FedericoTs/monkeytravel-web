/**
 * Native-aware external link opener.
 *
 * Inside the Capacitor mobile shell:
 *   - openExternal() uses @capacitor/browser to present the URL in an
 *     in-app browser (SFSafariViewController on iOS, Custom Tabs on
 *     Android). This is required because target="_blank" and
 *     window.open(url, "_blank") are silently swallowed in the iOS
 *     WKWebView — clicking does nothing, OR the URL replaces the
 *     WebView and breaks the back stack entirely.
 *
 * In the regular web browser:
 *   - openExternal() falls back to window.open(url, "_blank") with the
 *     standard "noopener,noreferrer" hardening.
 *
 * Dynamic-import the @capacitor/browser plugin so its module never
 * enters the regular web bundle. Mirrors the pattern in share.ts and
 * back-button.ts.
 *
 * Usage:
 *   import { openExternal } from "@/lib/native/external-link";
 *   onClick={() => { trackPartnerClick(...); openExternal(partnerUrl); }}
 *
 * Callers that previously rendered <a target="_blank"> for booking
 * partners or other external CTAs should switch to a <button> that
 * calls openExternal(). Preserve any analytics tracking that ran on
 * click — call it BEFORE openExternal() so the event ships even if the
 * browser is slow to open.
 */

interface OpenExternalOptions {
  /**
   * iOS SFSafariViewController presentation style. "popover" matches
   * Apple's "in-app browser" feel; "fullscreen" replaces the screen.
   * Defaults to "popover" — feels less like a context switch.
   */
  presentationStyle?: "popover" | "fullscreen";
}

/**
 * Open an external URL using the best available channel for the
 * current platform. Always non-blocking — the promise resolves once
 * the system has accepted the open request.
 */
export async function openExternal(
  url: string,
  options: OpenExternalOptions = {}
): Promise<void> {
  if (typeof window === "undefined") return;

  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;

  // 1. Native shell — use @capacitor/browser so the URL opens in
  //    SFSafariViewController / Chrome Custom Tabs instead of being
  //    swallowed by the WebView.
  if (cap?.isNativePlatform?.()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({
        url,
        presentationStyle: options.presentationStyle ?? "popover",
      });
      return;
    } catch (err) {
      // Real failure — log and fall through to the web-style fallback
      // (which on Capacitor will still likely fail, but at least we
      // tried something instead of silently doing nothing).
      console.warn(
        "[native/external-link] Capacitor Browser.open failed, falling back",
        err
      );
    }
  }

  // 2. Regular browser — standard new-tab open with hardening.
  window.open(url, "_blank", "noopener,noreferrer");
}
