import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and while hydrating, true in the browser after that.
 * For what only exists client-side (portals, browser APIs) without a mount
 * effect and the extra render it costs.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
