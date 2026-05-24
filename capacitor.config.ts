import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config — drives the iOS + Android native shells.
 *
 * STRATEGY: thin native wrapper around the live production site. The
 * WebView loads `server.url` on every cold launch — no bundled web build,
 * no separate codebase. When we ship a web change, every installed app
 * gets it on next launch (no App Store review). This is the explicit
 * trade-off documented in `.audit/implementation-plans.md` §1: ship
 * velocity > offline-first.
 *
 * The native shell only adds: native share sheet, status-bar color,
 * splash screen, custom URL scheme for deep links, and (in v1.1) push
 * notifications. Everything else is the website.
 *
 * Local workflow:
 *   1. User runs `npx cap add ios` / `npx cap add android` — writes the
 *      platform folders. NOT committed here (they're big, change with
 *      every SDK update, and don't need code review).
 *   2. User runs `npx cap open ios|android` to launch Xcode / Studio.
 *   3. After any change to *this* file: `npx cap sync` to push it into
 *      the native projects.
 */
const config: CapacitorConfig = {
  // Reverse-DNS app id. Must match the Apple bundle identifier and the
  // Android applicationId. Changing this later is painful — pick once.
  appId: "app.monkeytravel",
  appName: "MonkeyTravel",

  // Where the WebView loads. No `webDir` because we're not bundling — the
  // site is the live URL. The bundled `src` is just a no-op placeholder
  // that gets overridden by `server.url` at runtime.
  webDir: "public",

  server: {
    url: "https://monkeytravel.app",
    // Allow http during local dev (e.g. pointing at localhost:3000 with
    // `cleartext: true`) without permanently weakening prod. Default off.
    cleartext: false,
  },

  // Each plugin's defaults are sensible — only override what we need to.
  plugins: {
    SplashScreen: {
      // Match the manifest theme so there's no flash on launch.
      launchShowDuration: 1200,
      backgroundColor: "#FFFAF5",
      // Center the splash logo; full-screen splash images are 2026-era.
      androidSplashResourceName: "splash",
      iosSplashResourceName: "Splash",
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      // Light status bar text on the brand color background.
      backgroundColor: "#FF6B6B",
      style: "DARK",
    },
  },

  ios: {
    contentInset: "automatic",
    // Allow the WebView's user-agent to be detected server-side via the
    // appended suffix. Middleware allowlists "MonkeyTravelApp/" — keep
    // these in sync. (See middleware.ts BLOCKED_BOT_PATTERNS comment.)
    overrideUserAgent: undefined, // use system + appendUserAgent below
    appendUserAgent: "MonkeyTravelApp/1.0",
  },
  android: {
    appendUserAgent: "MonkeyTravelApp/1.0",
    // Capacitor 6 default. Future-proofs against tightening cookie rules.
    allowMixedContent: false,
  },
};

export default config;
