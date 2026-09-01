/** @vitest-environment node */
import { describe, it, expect, afterEach, vi } from "vitest";
import { safeGet, safeSet, safeRemove, isStorageAvailable } from "./safe-storage";

/**
 * Reproduces the browser states that took the login page down.
 *
 * Sentry JAVASCRIPT-NEXTJS-28, production, Safari 26.6.2:
 *
 *   ReferenceError: Can't find variable: localStorage
 *   components/analytics/SessionTracker.tsx:58 (trackSession)
 *   handled: no — onunhandledrejection
 *
 * Safari with "block all cookies" does not give you an EMPTY localStorage — it
 * makes the identifier unresolvable, so a bare access throws before returning
 * anything. Inside an async function that becomes an unhandled rejection.
 *
 * Every case below is a real browser configuration, not a hypothetical.
 */

const g = globalThis as unknown as { window?: unknown };
const original = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else delete g.window;
  vi.restoreAllMocks();
});

/** Install a fake `window` whose storage behaves like the browser under test. */
function withStorage(storage: unknown) {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage, sessionStorage: storage },
    configurable: true,
    writable: true,
  });
}

/** A store that throws on every operation, the way a blocked one does. */
function blockedStore(message: string) {
  return {
    getItem() { throw new Error(message); },
    setItem() { throw new Error(message); },
    removeItem() { throw new Error(message); },
  };
}

function workingStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("a working browser behaves normally", () => {
  it("round-trips a value", () => {
    withStorage(workingStore());
    expect(safeSet("k", "v")).toBe(true);
    expect(safeGet("k")).toBe("v");
    expect(safeRemove("k")).toBe(true);
    expect(safeGet("k")).toBeNull();
  });

  it("reports storage as available", () => {
    withStorage(workingStore());
    expect(isStorageAvailable()).toBe(true);
  });

  it("returns null for a key that was never set", () => {
    withStorage(workingStore());
    expect(safeGet("never-set")).toBeNull();
  });
});

describe("Safari with storage blocked — the reported crash", () => {
  it("does not throw when reading", () => {
    // The exact shape of JAVASCRIPT-NEXTJS-28: the access itself raises.
    withStorage(blockedStore("Can't find variable: localStorage"));
    expect(() => safeGet("session_last_visit")).not.toThrow();
    expect(safeGet("session_last_visit")).toBeNull();
  });

  it("does not throw when writing", () => {
    withStorage(blockedStore("Can't find variable: localStorage"));
    expect(() => safeSet("session_count", "1")).not.toThrow();
    expect(safeSet("session_count", "1")).toBe(false);
  });

  it("reports storage as unavailable rather than pretending", () => {
    withStorage(blockedStore("Can't find variable: localStorage"));
    expect(isStorageAvailable()).toBe(false);
  });

  it("survives a store that is missing entirely", () => {
    Object.defineProperty(globalThis, "window", {
      value: {}, configurable: true, writable: true,
    });
    expect(safeGet("k")).toBeNull();
    expect(safeSet("k", "v")).toBe(false);
    expect(isStorageAvailable()).toBe(false);
  });
});

describe("Safari private mode — present but unwritable", () => {
  it("a store that reads fine and throws on write is NOT reported available", () => {
    // QuotaExceededError on the first write, even for one small value. A
    // `typeof localStorage !== "undefined"` check passes here and is not
    // enough on its own — which is why isStorageAvailable proves it with a
    // real round-trip instead of trusting presence.
    const readOnlyStore = {
      getItem: () => null,
      setItem() { throw new Error("QuotaExceededError"); },
      removeItem: () => {},
    };
    withStorage(readOnlyStore);
    expect(isStorageAvailable()).toBe(false);
    expect(safeSet("k", "v")).toBe(false);
    expect(() => safeGet("k")).not.toThrow();
  });
});

describe("server-side rendering", () => {
  it("has no window and must not throw", () => {
    delete g.window;
    expect(safeGet("k")).toBeNull();
    expect(safeSet("k", "v")).toBe(false);
    expect(safeRemove("k")).toBe(false);
    expect(isStorageAvailable()).toBe(false);
  });
});

describe("sessionStorage is covered too", () => {
  it("uses the session store when asked", () => {
    withStorage(workingStore());
    expect(safeSet("k", "v", "session")).toBe(true);
    expect(safeGet("k", "session")).toBe("v");
  });

  it("degrades the same way when blocked", () => {
    withStorage(blockedStore("blocked"));
    expect(safeGet("k", "session")).toBeNull();
    expect(safeSet("k", "v", "session")).toBe(false);
  });
});

describe("the shape SessionTracker relied on", () => {
  it("parseInt(safeGet(...) || \"0\") still yields a usable count when blocked", () => {
    // The line that threw was:
    //   parseInt(localStorage.getItem(SESSION_COUNT_KEY) || "0", 10) + 1
    // With a blocked store this must produce 1 — a first session — rather
    // than taking down the page.
    withStorage(blockedStore("Can't find variable: localStorage"));
    const count = parseInt(safeGet("mt_session_count") || "0", 10) + 1;
    expect(count).toBe(1);
  });
});
