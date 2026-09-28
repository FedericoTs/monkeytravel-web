/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";

// The routing module drags next-intl's client navigation into a node test;
// only the locale list matters here.
vi.mock("@/lib/i18n/routing", () => ({ routing: { locales: ["en", "es", "it", "pt"], defaultLocale: "en" } }));

import { isStaticPagePath, STATIC_ROUTES } from "./static-routes";

describe("isStaticPagePath: the paths middleware serves from the CDN", () => {
  it("matches the locale homepages", () => {
    for (const p of ["/", "/it", "/es", "/pt"]) expect(isStaticPagePath(p), p).toBe(true);
  });

  it("matches prerendered pages with and without a locale prefix", () => {
    for (const p of [
      "/blog",
      "/it/blog",
      "/blog/where-to-go-in-december",
      "/pt/blog/tag/europe",
      "/destinations/paris",
      "/es/destinations/style/romantic",
      "/tools/packing-list",
      "/privacy",
      "/it/passport/italy",
    ]) {
      expect(isStaticPagePath(p), p).toBe(true);
    }
  });

  it("rejects pages rendered per request", () => {
    for (const p of [
      "/trips/new",
      "/it/trips/new",
      "/trips/abc123",
      "/auth/login",
      "/explore",
      "/admin",
      "/api/health",
      "/shared/token",
      "/creator/someone",
      "/trip/some-slug",
      "/tools/visa-checker",
    ]) {
      expect(isStaticPagePath(p), p).toBe(false);
    }
  });

  it("does not let a dynamic segment swallow deeper paths", () => {
    expect(isStaticPagePath("/blog/a/b")).toBe(false);
    expect(isStaticPagePath("/destinations/paris/extra")).toBe(false);
    // "en" carries no prefix, so an explicit /en path is a redirect, never a page.
    expect(isStaticPagePath("/en/blog")).toBe(false);
  });

  it("keeps the list in Next's route syntax", () => {
    for (const r of STATIC_ROUTES) expect(r).toMatch(/^\/\[locale\](\/|$)/);
  });
});
