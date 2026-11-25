/**
 * Runs `record` now when the page is visible, else once it first becomes visible: a page the browser loads in the
 * background (restoring its tabs, a prerender) isn't seen by anyone, so what it records as "viewed" waits, the way
 * PostHog's own first page view does, and a page never looked at records nothing. Gives back a cancel for an effect's
 * cleanup, or undefined when it ran at once.
 */
export function whenSeen(record: () => void): (() => void) | undefined {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    record();
    return undefined;
  }
  const onChange = () => {
    if (document.visibilityState !== "visible") return;
    document.removeEventListener("visibilitychange", onChange);
    record();
  };
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
