/**
 * Android hardware back-button handler.
 *
 * Without this, Android's hardware/gesture back inside the WebView
 * triggers the WebView's default — which on Capacitor v6 is "exit app
 * if at the root, otherwise navigate web history." That breaks when a
 * programmatic navigation (Next.js `router.push`) doesn't register as a
 * history entry that "back" can pop.
 *
 * Our handler:
 *   - If window.history.length > 1, history.back()
 *   - Else exit the app
 *
 * An open modal does not intercept it: back pops the route under it.
 */

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
    const listener = await App.addListener("backButton", () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }

      // At the root — exit the app.
      App.exitApp();
    });
    return () => listener.remove();
  } catch (err) {
    console.warn("[back-button] install failed:", err);
    return () => undefined;
  }
}
