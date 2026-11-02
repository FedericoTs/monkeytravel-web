/**
 * True inside the Capacitor native shell (the iOS and Android apps' WebView),
 * false in a browser and on the server. The runtime injects the `Capacitor`
 * global; a plain browser doesn't have it.
 */
export function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}
