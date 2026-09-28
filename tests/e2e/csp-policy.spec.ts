import { test, expect } from "@playwright/test";

/**
 * Which Content-Security-Policy each kind of page gets. Prerendered pages are
 * served from the CDN, so their inline scripts are pinned by hash; pages
 * rendered per request carry a nonce. Neither may fall back to unsafe-inline.
 */

function scriptSrc(csp: string | undefined): string[] {
  const line = (csp ?? "").split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
  return line ? line.split(/\s+/).slice(1) : [];
}

test.describe("CSP @prod", () => {
  for (const path of ["/", "/blog", "/it/ai-itinerary-generator", "/tools/packing-list"]) {
    test(`${path} is prerendered: hash policy, no nonce`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const src = scriptSrc(res.headers()["content-security-policy"]);
      expect(src.filter((s) => s.startsWith("'sha256-")).length).toBeGreaterThan(0);
      expect(src.some((s) => s.startsWith("'nonce-"))).toBe(false);
      expect(src).not.toContain("'unsafe-inline'");
      expect(src).not.toContain("'unsafe-eval'");
    });
  }

  for (const path of ["/trips/new", "/auth/login", "/definitely-not-a-page"]) {
    test(`${path} is rendered per request: nonce policy`, async ({ request }) => {
      const res = await request.get(path);
      const src = scriptSrc(res.headers()["content-security-policy"]);
      expect(src.some((s) => s.startsWith("'nonce-"))).toBe(true);
      expect(src).toContain("'strict-dynamic'");
      expect(src).not.toContain("'unsafe-inline'");
    });
  }
});
