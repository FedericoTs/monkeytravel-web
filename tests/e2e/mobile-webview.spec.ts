import { test, expect } from "@playwright/test";

/**
 * Mobile WebView smoke tests.
 *
 * The Capacitor shell appends "MonkeyTravelApp/1.0" to the system UA
 * (see capacitor.config.ts → ios/android appendUserAgent). The bot
 * blocker in middleware.ts must NOT 403 that UA. A regression here =
 * every install lands on a 403 page on first launch.
 *
 * Also smoke-checks the .well-known manifests Apple + Google fetch
 * for Universal Links / App Links verification.
 */

const IOS_WEBVIEW_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22A3354 MonkeyTravelApp/1.0";

const ANDROID_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36 MonkeyTravelApp/1.0";

test.describe("Mobile WebView UA @prod", () => {
  test("homepage loads under iOS WebView UA (not 403)", async ({ request }) => {
    const res = await request.get("/", {
      headers: { "user-agent": IOS_WEBVIEW_UA },
    });
    expect(res.status(), `iOS WebView UA must not be 403`).toBe(200);
    const html = await res.text();
    // Must actually render — not a 403 served as text/html.
    expect(html).toContain("MonkeyTravel");
  });

  test("homepage loads under Android WebView UA (not 403)", async ({
    request,
  }) => {
    const res = await request.get("/", {
      headers: { "user-agent": ANDROID_WEBVIEW_UA },
    });
    expect(res.status(), `Android WebView UA must not be 403`).toBe(200);
  });

  test("auth callback path loads under WebView UA (cookie set path)", async ({
    request,
  }) => {
    // Anonymous hit on the callback with no code returns the route's
    // graceful error path — what matters is it's not 403.
    const res = await request.get("/auth/callback", {
      headers: { "user-agent": IOS_WEBVIEW_UA },
      maxRedirects: 0,
    });
    expect([200, 302, 303, 307, 308, 400, 404]).toContain(res.status());
  });
});

test.describe("Mobile deep-link manifests @prod", () => {
  test("apple-app-site-association is served as JSON", async ({ request }) => {
    const res = await request.get("/.well-known/apple-app-site-association");
    expect(res.status()).toBe(200);
    // Apple is strict about Content-Type — must be application/json.
    expect(res.headers()["content-type"]).toMatch(/application\/json/);
    const json = await res.json();
    expect(json).toHaveProperty("applinks");
    expect(json.applinks).toHaveProperty("details");
    expect(Array.isArray(json.applinks.details)).toBe(true);
  });

  test("assetlinks.json is served as JSON", async ({ request }) => {
    const res = await request.get("/.well-known/assetlinks.json");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/application\/json/);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json[0]).toHaveProperty("relation");
    expect(json[0]).toHaveProperty("target");
  });

  test(".well-known paths bypass i18n redirects", async ({ request }) => {
    // Without the middleware bypass, /.well-known/apple-app-site-association
    // would 308 to /en/.well-known/... — which Apple wouldn't follow.
    const res = await request.get("/.well-known/apple-app-site-association", {
      maxRedirects: 0,
    });
    expect([200], "must be 200 directly, no locale redirect").toContain(
      res.status()
    );
  });
});
