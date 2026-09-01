/**
 * Browser storage that cannot take the page down with it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Sentry JAVASCRIPT-NEXTJS-28, production, Safari 26.6.2 on Mac:
 *
 *   ReferenceError: Can't find variable: localStorage
 *   components/analytics/SessionTracker.tsx:58 (trackSession)
 *   handled: no — auto.browser.global_handlers.onunhandledrejection
 *
 * Safari with "block all cookies" — and some private-browsing setups — does
 * not give you an EMPTY localStorage. It makes the identifier unresolvable, so
 * a bare `localStorage.getItem(x)` throws a ReferenceError before it can
 * return anything. Inside an async function that becomes an unhandled
 * rejection, which is how this reached Sentry from the login page.
 *
 * WHY `typeof` ALONE IS ENOUGH, AND WHY THIS STILL WRAPS IN try/catch
 * -------------------------------------------------------------------
 * `typeof someUndeclaredIdentifier` is the one operator that does NOT throw on
 * an unresolvable name — it returns "undefined". So lib/consent/storage.ts,
 * which checks `typeof localStorage !== "undefined"` before use, was already
 * correct and is untouched.
 *
 * The try/catch is for the OTHER failure: a browser where the identifier
 * resolves but the operation throws anyway — Safari raises QuotaExceededError
 * on write in private mode, and enterprise policies can make reads throw.
 * Both are real, and neither is caught by a typeof check.
 *
 * WHAT CALLERS GET
 * ----------------
 * Reads return null and writes return false rather than throwing. Storage is
 * a convenience everywhere it is used in this codebase — a remembered session
 * count, a dismissed banner — so degrading to "we don't know" is always
 * better than taking down the page that was trying to remember.
 */

/** True when storage is present AND usable. */
export function isStorageAvailable(kind: "local" | "session" = "local"): boolean {
  try {
    // typeof first: on Safari with storage blocked the identifier itself does
    // not resolve, and any other form of access would throw here.
    if (typeof window === "undefined") return false;
    const store = kind === "local" ? window.localStorage : window.sessionStorage;
    if (!store) return false;
    // Presence is not usability. A blocked store can exist and still throw on
    // the first real operation, so prove it with one.
    const probe = "__mt_storage_probe__";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function store(kind: "local" | "session"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return (kind === "local" ? window.localStorage : window.sessionStorage) ?? null;
  } catch {
    return null;
  }
}

/** Read a key, or null if storage is unavailable, blocked, or the key is unset. */
export function safeGet(key: string, kind: "local" | "session" = "local"): string | null {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write a key. Returns false when it could not be stored. */
export function safeSet(key: string, value: string, kind: "local" | "session" = "local"): boolean {
  try {
    const s = store(kind);
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    // Safari in private mode throws QuotaExceededError on every write, even
    // for a single small value.
    return false;
  }
}

/** Remove a key. Returns false when it could not be removed. */
export function safeRemove(key: string, kind: "local" | "session" = "local"): boolean {
  try {
    const s = store(kind);
    if (!s) return false;
    s.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
