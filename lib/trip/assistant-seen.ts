/**
 * Whether this browser has opened the trip assistant before. Kept in a cookie
 * as well as localStorage so the server can lay out the docked panel column on
 * a first visit, before the auto-opened panel arrives.
 */
export const ASSISTANT_SEEN_COOKIE = "mt_ai_assistant_seen";

export function rememberAssistantSeen(): void {
  try {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${ASSISTANT_SEEN_COOKIE}=1; path=/; max-age=31536000; samesite=lax${secure}`;
  } catch {
    // Cookies blocked: the assistant opens by itself once more, nothing worse.
  }
}
