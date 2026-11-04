/**
 * The text to show for a caught error: what our own code threw, usually a
 * server's written answer (`new Error(data.error)`), else `fallback`.
 *
 * A runtime's own error is never shown. A dropped connection is a TypeError
 * reading "Failed to fetch" or "Load failed" depending on the browser, and an
 * HTML 504 read as JSON a SyntaxError, in English whatever the page's language.
 * `err instanceof Error ? err.message : t(...)` shows them all, and its
 * translated text never: every one of these is an Error.
 */
export function shownErrorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.name === "Error" && err.message ? err.message : fallback;
}
