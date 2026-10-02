/**
 * Refreshing Today when its live channel says something changed. Anyone who
 * has seen the trip can send on that channel, so its events must not turn
 * into unbounded reads: refreshes run at most once per `gapMs`, never two at
 * once, and a burst ends in one trailing refresh so the last change is never
 * missed.
 */
export const TODAY_REFRESH_GAP_MS = 3_000;

export function throttledRefresh(run: () => Promise<unknown>, gapMs: number) {
  let running = false;
  let again = false;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const start = async () => {
    timer = null;
    running = true;
    again = false;
    lastStart = Date.now();
    try {
      await run();
    } catch {
      // The next request tries again.
    } finally {
      running = false;
      if (again) request();
    }
  };

  function request() {
    if (running) {
      again = true;
      return;
    }
    if (timer) return;
    timer = setTimeout(() => void start(), Math.max(0, lastStart + gapMs - Date.now()));
  }

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    again = false;
  };

  return { request, cancel };
}

/** The previous value when the new one is equal, so a refresh that changed nothing re-renders nothing. */
export function keepIfSame<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}
