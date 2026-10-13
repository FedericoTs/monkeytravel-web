/**
 * Whether this browser has opened the trip assistant before. Kept in a cookie
 * as well as localStorage so the server can lay out the docked panel column on
 * a first visit, before the auto-opened panel arrives.
 */
export const ASSISTANT_SEEN_COOKIE = "mt_ai_assistant_seen";

// The attribute <html> carries when the browser remembers the assistant.
export const ASSISTANT_SEEN_ATTRIBUTE = "data-assistant-seen";

/**
 * Runs before the page paints: marks <html> when localStorage remembers the
 * assistant, so CSS drops a column the server reserved because the cookie was
 * gone (Safari expires cookies set from script). Constant, so the CSP admits
 * it by hash.
 */
export const ASSISTANT_SEEN_SCRIPT = `try{localStorage.getItem("${ASSISTANT_SEEN_COOKIE}")&&document.documentElement.setAttribute("${ASSISTANT_SEEN_ATTRIBUTE}","")}catch(e){}`;

export function assistantSeenScriptProps(): { dangerouslySetInnerHTML: { __html: string } } {
  return { dangerouslySetInnerHTML: { __html: ASSISTANT_SEEN_SCRIPT } };
}

export function rememberAssistantSeen(): void {
  try {
    document.documentElement.setAttribute(ASSISTANT_SEEN_ATTRIBUTE, "");
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${ASSISTANT_SEEN_COOKIE}=1; path=/; max-age=31536000; samesite=lax${secure}`;
  } catch {
    // Cookies blocked: the assistant opens by itself once more, nothing worse.
  }
}
