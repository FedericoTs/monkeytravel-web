/**
 * Native-aware share + clipboard helpers.
 *
 * Inside the Capacitor mobile shell:
 *   - shareLink() uses the native share sheet via @capacitor/share
 *   - copyToClipboard() uses @capacitor/clipboard fallback (TODO if we
 *     ship @capacitor/clipboard; for now navigator.clipboard works inside
 *     the WebView too because Capacitor proxies it.)
 *
 * In the regular web browser:
 *   - shareLink() uses navigator.share when available, falls back to
 *     copying the URL to the clipboard with a toast message.
 *   - copyToClipboard() is a thin wrapper that handles secure-context
 *     gotchas (Android Chrome on http requires a fallback).
 *
 * The native detection is dynamic-import-guarded: in the browser bundle
 * we don't pay for @capacitor/share unless we're actually inside the
 * app. Avoids loading native plugin code in the web bundle.
 */

interface ShareOptions {
  title?: string;
  text?: string;
  url: string;
  /** Native dialog title (Android). Default "Share". */
  dialogTitle?: string;
}

/**
 * Detect whether we're running inside the Capacitor native shell. The
 * `Capacitor` global is injected by the runtime; in a plain browser
 * it's undefined.
 */
function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Share a link using the best available channel.
 * Returns true if the OS share dialog opened (or we copied to clipboard
 * as a fallback). Returns false if the user cancelled the OS dialog.
 */
export async function shareLink(options: ShareOptions): Promise<boolean> {
  // 1. Native shell — use @capacitor/share.
  if (isNativePlatform()) {
    try {
      // Dynamic import so the plugin module never enters the web bundle.
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: options.title,
        text: options.text,
        url: options.url,
        dialogTitle: options.dialogTitle ?? "Share",
      });
      return true;
    } catch (err) {
      // User cancellation throws — distinguish from real errors.
      const msg = err instanceof Error ? err.message : String(err);
      if (/cancel/i.test(msg)) return false;
      // Real error — fall through to web fallback path below.
      console.warn("[native/share] Capacitor share failed, falling back", msg);
    }
  }

  // 2. Web Share API (mobile Safari, modern Chrome, etc).
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: options.title,
        text: options.text,
        url: options.url,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort|cancel/i.test(msg)) return false;
      // Browser doesn't support sharing this URL (e.g. http origin) —
      // fall through to clipboard.
    }
  }

  // 3. Last resort: copy to clipboard and let the caller toast.
  const copied = await copyToClipboard(options.url);
  return copied;
}

/**
 * Copy a string to the clipboard. Tries navigator.clipboard first
 * (preferred), falls back to the deprecated execCommand trick for
 * non-secure contexts (older Android Chrome on http).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false;

  // 1. Modern API (works in https + localhost + Capacitor WebView).
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permissions API denied — fall through.
    }
  }

  // 2. Fallback for non-secure contexts.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Convenience: detect whether the caller is inside the Capacitor shell.
 * Re-exported for callers that need to branch (e.g. hide Web-specific
 * UI like "Add to home screen" buttons inside the native app).
 */
export function isNative(): boolean {
  return isNativePlatform();
}
