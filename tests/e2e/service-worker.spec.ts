import { test, expect } from "@playwright/test";

/**
 * Service worker contract.
 *
 * Verifies:
 *   - /sw.js is served (200, application/javascript)
 *   - /sw.js advertises the right cache version + strategies in the
 *     file body (proxy for "did we deploy the SW we think we did")
 *
 * What requires a real browser context with SW enabled (defer to manual
 * QA on a device):
 *   - Cache hit on second load of /trips/[id]
 *   - Offline cold-load of a previously-viewed trip returns cached HTML
 *   - Auth-sensitive paths bypass the SW
 */

test.describe("Service worker @prod", () => {
  test("GET /sw.js returns the worker file", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    const ct = res.headers()["content-type"] || "";
    expect(ct).toMatch(/javascript|application\/octet-stream/);
  });

  test("SW file advertises expected cache version + strategy", async ({
    request,
  }) => {
    const res = await request.get("/sw.js");
    const body = await res.text();
    // These are stable identifiers used by lib/sw/register.ts and the
    // SW file itself. A regression here means we deployed something
    // different from what we tested.
    expect(body).toContain("CACHE_VERSION");
    expect(body).toContain("staleWhileRevalidate");
    expect(body).toContain("cacheFirst");
    // Auth-sensitive paths must be explicitly excluded from caching.
    expect(body).toContain("/api/auth/");
    expect(body).toContain("/api/ai/");
    expect(body).toContain("/api/profile");
  });
});
