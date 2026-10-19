/** @vitest-environment node */
import { afterEach, describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

describe("check-static-routes: the post-build check of the prerendered pages", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // One concrete path per listed route: "/[locale]/blog/[slug]" -> "/en/blog/x".
  const path = (route: string) => route.replace("[locale]", "en").replace(/\[[^\]]+\]/g, "x");

  const run = (entry: (route: string) => object, htmlFiles: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), "static-routes-"));
    dirs.push(dir);
    const routes: Record<string, object> = {
      "/sitemap.xml": { routeType: "route", srcRoute: "/sitemap.xml", initialRevalidateSeconds: false },
      "/feed.xml": { routeType: "route", srcRoute: "/feed.xml", initialRevalidateSeconds: 3600 },
    };
    for (const r of STATIC_ROUTES) routes[path(r)] = { srcRoute: r, initialRevalidateSeconds: false, ...entry(r) };
    writeFileSync(join(dir, "prerender-manifest.json"), JSON.stringify({ version: 4, routes, dynamicRoutes: {} }));
    for (const f of htmlFiles) {
      mkdirSync(dirname(join(dir, "server", "app", f)), { recursive: true });
      writeFileSync(join(dir, "server", "app", f), "<html></html>");
    }
    try {
      return { status: 0, out: execFileSync("node", ["scripts/check-static-routes.mjs", dir], { encoding: "utf8", stdio: "pipe" }) };
    } catch (err) {
      const e = err as { status: number; stderr: string };
      return { status: e.status, out: e.stderr };
    }
  };

  it("finds every listed page in a manifest that marks pages, with no HTML on disk", () => {
    const { status, out } = run(() => ({ routeType: "page" }));
    expect(status).toBe(0);
    expect(out).toContain(`${STATIC_ROUTES.length} prerendered route(s) match`);
  });

  it("goes by the HTML files when the manifest does not mark its entries", () => {
    expect(run(() => ({}), STATIC_ROUTES.map((r) => `${path(r)}.html`)).status).toBe(0);
    const missing = run(() => ({}));
    expect(missing.status).toBe(1);
    expect(missing.out).toContain("Listed but no longer prerendered");
  });

  it("still fails when a page would revalidate after the build", () => {
    const { status, out } = run((r) => ({ routeType: "page", ...(r === "/[locale]/blog" ? { initialRevalidateSeconds: 60 } : {}) }));
    expect(status).toBe(1);
    expect(out).toContain("revalidate after the build");
  });
});
