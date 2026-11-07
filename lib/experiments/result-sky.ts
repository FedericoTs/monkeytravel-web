/**
 * Whether the plan shows as the sky. Only when asked for, for now: a link with
 * ?result_variant=sky turns it on in this browser and ?result_variant=classic
 * turns it back off, so it can be tried on real plans before anyone else sees it.
 */
const KEY = "mt_result_sky";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readsSky(asked: string | null | undefined, store: Store | null): boolean {
  try {
    if (asked === "sky") store?.setItem(KEY, "1");
    if (asked === "classic") store?.removeItem(KEY);
    return asked === "sky" || store?.getItem(KEY) === "1";
  } catch {
    // Storage refused, as in some private windows: the link still works for this page.
    return asked === "sky";
  }
}
