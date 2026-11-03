import { useState } from "react";

/**
 * Whether `value` differs from what it was in the last render. For state that
 * follows a prop: set it while rendering when this is true, so React applies
 * it before anything paints, instead of in an effect after the stale render
 * has committed. Primitives only: a new object every render would never
 * settle, so compare a key (such as a joined list) instead.
 */
export function useChanged<T extends string | number | boolean | null | undefined>(value: T): boolean {
  const [last, setLast] = useState(value);
  if (Object.is(last, value)) return false;
  setLast(value);
  return true;
}
