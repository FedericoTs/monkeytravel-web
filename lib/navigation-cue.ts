/**
 * The cue that a tap is opening another page. The app's Link starts it when a
 * navigation really begins; NavigationCue draws it and ends it when the address
 * changes. A signal at module level, as the two sit far apart on the page.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

/** Starts the cue, unless the target is the page already shown (a jump within it). */
export function startNavigationCue(target?: string | null): void {
  if (typeof window === "undefined") return;
  if (target) {
    const next = new URL(target, window.location.href);
    const here = window.location;
    if (next.origin === here.origin && next.pathname === here.pathname && next.search === here.search) return;
  }
  for (const listener of listeners) listener();
}

/** Calls `listener` at each start; the returned function stops it. */
export function onNavigationStart(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
