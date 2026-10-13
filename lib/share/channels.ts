/**
 * Where a share goes from a button tap: the phone's share sheet, or WhatsApp
 * (the app on a phone, WhatsApp Web elsewhere).
 */

/** Phones get their share sheet; elsewhere WhatsApp is the target. */
export function canShareNatively(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

export const whatsappUrl = (message: string) => `https://wa.me/?text=${encodeURIComponent(message)}`;

/**
 * Opens WhatsApp with the message; false when the browser blocked the window.
 * Not with the "noopener" feature: with it, window.open returns null even when
 * the window opens, which reads as blocked. The opener is cut by hand instead.
 */
export function openWhatsApp(message: string): boolean {
  const win = window.open(whatsappUrl(message), "_blank");
  if (!win) return false;
  try {
    win.opener = null;
  } catch {
    // Already navigated away: nothing left to cut.
  }
  return true;
}
