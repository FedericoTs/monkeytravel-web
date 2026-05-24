/**
 * Android hardware back-button handler.
 *
 * Without this, Android's hardware/gesture back inside the WebView
 * triggers the WebView's default — which on Capacitor v6 is "exit app
 * if at the root, otherwise navigate web history." That sounds right
 * but breaks in two cases:
 *   1. Programmatic navigations (Next.js `router.push`) sometimes don't
 *      register as history entries that "back" can pop.
 *   2. Modals — back should close the modal, not pop the route.
 *
 * Our handler:
 *   - If a registered "modal interceptor" handles it, stop there
 *   - Else if window.history.length > 1, history.back()
 *   - Else exit the app
 *
 * The modal-interceptor API lets a modal subscribe to back-button
 * events while open. Pattern:
 *   useEffect(() => {
 *     const off = onBackButton(() => { close(); return true; });
 *     return off;
 *   }, [close]);
 *
 * Returning true = "I handled it, don't propagate."
 */

type BackHandler = () => boolean | Promise<boolean>;

const handlers: BackHandler[] = [];

/**
 * Register a back-button handler. Returns an unsubscribe function.
 * Handlers are LIFO — most-recently-registered (i.e. topmost modal)
 * gets first crack.
 */
export function onBackButton(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  };
}

/**
 * Install the global handler. Called once from the layout-level
 * client island. Dynamic-imports @capacitor/app so the plugin code
 * never enters the regular web bundle.
 */
export async function installBackButtonHandler(): Promise<() => void> {
  if (typeof window === "undefined") return () => undefined;

  // Detect Capacitor — bail in the regular web context, where the
  // browser's back button already does the right thing.
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  if (!cap?.isNativePlatform?.()) return () => undefined;

  try {
    const { App } = await import("@capacitor/app");
    const listener = await App.addListener("backButton", async () => {
      // Try each registered handler in LIFO order.
      for (let i = handlers.length - 1; i >= 0; i--) {
        try {
          const handled = await handlers[i]();
          if (handled) return;
        } catch (err) {
          // A throwing handler shouldn't break navigation.
          console.warn("[back-button] handler threw:", err);
        }
      }

      // No handler took it. Fall back to web history if we can.
      if (window.history.length > 1) {
        window.history.back();
        return;
      }

      // At the root with no handlers — exit the app.
      App.exitApp();
    });
    return () => listener.remove();
  } catch (err) {
    console.warn("[back-button] install failed:", err);
    return () => undefined;
  }
}
