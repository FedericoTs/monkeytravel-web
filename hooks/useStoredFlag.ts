"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { safeGet, safeSet } from "@/lib/safe-storage";

const readers = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  readers.add(onChange);
  return () => {
    readers.delete(onChange);
  };
}

/**
 * A yes/no this browser keeps under `key`, such as a dismissed banner: null
 * on the server and while hydrating, then whether it was set. `set` stores it
 * and updates every component reading it. `value` is what a set flag holds.
 */
export function useStoredFlag(key: string, value = "true"): [boolean | null, () => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => safeGet(key) === value,
    () => null
  );
  // Where storage is blocked, a flag set here still holds while this component is mounted.
  const [keySetHere, setKeySetHere] = useState<string | null>(null);
  const set = useCallback(() => {
    setKeySetHere(key);
    safeSet(key, value);
    readers.forEach((read) => read());
  }, [key, value]);
  return [keySetHere === key || stored, set];
}
