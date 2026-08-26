/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { buildCspHeader, allowsThirdPartyFraming } from "./csp";

/**
 * The CSP has silently dropped analytics twice, the same way both times.
 *
 * A `connect-src` entry of `https://analytics.google.com` matches ONLY that
 * exact host. GA4 sends the collect beacon to the apex for some traffic and to
 * regional subdomains (region1.analytics.google.com, region2., ...) for EU/UK
 * traffic. The 2026-07-02 fix added the apex and restored US measurement; every
 * EU hit stayed blocked and nobody noticed for six weeks, because a blocked
 * beacon looks exactly like no traffic.
 *
 * Nothing about that failure is visible from the server: the page renders, the
 * request 200s, and the only evidence is a console line in a real browser. So
 * the allowlist is asserted here instead.
 */

/** Mirrors the browser's matching rules closely enough to catch apex/subdomain slips. */
function allows(directive: string[], url: string): boolean {
  const host = new URL(url).host;
  return directive.some((src) => {
    if (src === "'self'" || src.startsWith("'")) return false;
    const srcHost = src.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (srcHost.startsWith("*.")) {
      // A CSP wildcard matches subdomains only — never the apex.
      return host.endsWith(srcHost.slice(1)) && host !== srcHost.slice(2);
    }
    return host === srcHost;
  });
}

/** Any non-landing path — connect-src doesn't vary by route, so the exact value is arbitrary. */
const A_ROUTE = "/trips/new";

function directive(name: string, pathname: string = A_ROUTE): string[] {
  const header = buildCspHeader("test-nonce", pathname);
  const line = header.split(";").map((d) => d.trim()).find((d) => d.startsWith(name));
  expect(line, `${name} missing from the CSP`).toBeTruthy();
  return line!.split(/\s+/).slice(1);
}

function connectSrc(pathname: string = A_ROUTE): string[] {
  return directive("connect-src", pathname);
}

describe("CSP connect-src allows the analytics endpoints GA4 actually uses", () => {
  const GA_ENDPOINTS = [
    "https://www.google-analytics.com/g/collect",
    "https://analytics.google.com/g/collect",
    // The regional endpoints. EU/UK traffic goes here, which for this product
    // is Italy, Spain and Portugal — the markets the localized content targets.
    "https://region1.analytics.google.com/g/collect",
    "https://region2.analytics.google.com/g/collect",
    "https://stats.g.doubleclick.net/g/collect",
  ];

  it.each(GA_ENDPOINTS)("allows %s", (url) => {
    expect(allows(connectSrc(), url)).toBe(true);
  });

  it("keeps the apex entry — a *. wildcard does NOT cover it", () => {
    // The trap that caused this: dropping "https://analytics.google.com" in
    // favour of the wildcard would silently re-break non-regional traffic.
    const src = connectSrc();
    expect(src).toContain("https://analytics.google.com");
    expect(src).toContain("https://*.analytics.google.com");
  });

  it("allows the affiliate loader to fetch its config", () => {
    // emrldco.com was in script-src but not connect-src, so the script ran and
    // then failed on https://emrldco.com/entrypoint_config — it rendered no
    // affiliate links at all in production.
    expect(allows(connectSrc(), "https://emrldco.com/entrypoint_config?t=483997")).toBe(true);
  });

  it("does NOT allow the affiliate script's third-party error reporting", () => {
    // sentry.avs.io is Aviasales' own Sentry. Affiliate links work without it,
    // and allowing it would ship visited page URLs to a third party.
    expect(allows(connectSrc(), "https://sentry.avs.io/api/20/envelope/")).toBe(false);
  });

  it("still refuses hosts that are not on the allowlist", () => {
    // Guard against someone 'fixing' a block by widening the policy to https:.
    const src = connectSrc();
    for (const url of ["https://evil.example.com/x", "https://analytics.google.com.evil.com/x"]) {
      expect(allows(src, url), url).toBe(false);
    }
  });

  it("the helper models CSP wildcard semantics correctly", () => {
    // If this is wrong, every assertion above is meaningless.
    expect(allows(["https://*.example.com"], "https://a.example.com/x")).toBe(true);
    expect(allows(["https://*.example.com"], "https://example.com/x")).toBe(false);
    expect(allows(["https://example.com"], "https://a.example.com/x")).toBe(false);
    expect(allows(["https://example.com"], "https://example.com/x")).toBe(true);
  });
});

/**
 * BuildHop (a launch-directory site) needs to iframe the homepage for its
 * listing preview. Scoped to the four locale homepages only — everywhere
 * else keeps 'self'-only, so this can't quietly widen to an authenticated
 * route (trips, admin) where letting a third party frame the page would be
 * a real clickjacking exposure, not just an embed-preview convenience.
 */
describe("CSP frame-ancestors: BuildHop is scoped to the homepage only", () => {
  const HOMEPAGES = ["/", "/es", "/it", "/pt"];
  const OTHER_ROUTES = [
    "/trips/new",
    "/trips/abc123",
    "/admin",
    "/auth/login",
    "/blog",
    "/blog/where-to-go-in-december",
    "/es/blog/where-to-go-in-december",
    // Prefix trap: starts with "/es" but is NOT the Spanish homepage.
    "/estimate",
  ];

  it.each(HOMEPAGES)("allows buildhop.io to frame %s", (path) => {
    const fa = directive("frame-ancestors", path);
    expect(fa).toContain("https://buildhop.io");
    expect(fa).toContain("https://www.buildhop.io");
  });

  it.each(HOMEPAGES)("keeps 'self' alongside buildhop.io on %s", (path) => {
    // The constraint was to preserve 'self', not replace it.
    expect(directive("frame-ancestors", path)).toContain("'self'");
  });

  it.each(OTHER_ROUTES)("does NOT allow buildhop.io to frame %s", (path) => {
    const fa = directive("frame-ancestors", path);
    expect(fa).toEqual(["'self'"]);
  });

  it("touches only frame-ancestors — every other directive is identical on and off the homepage", () => {
    const home = buildCspHeader("test-nonce", "/");
    const other = buildCspHeader("test-nonce", A_ROUTE);
    const stripLine = (h: string, name: string) =>
      h.split(";").map((d) => d.trim()).filter((d) => !d.startsWith(name)).join("; ");
    expect(stripLine(home, "frame-ancestors")).toBe(stripLine(other, "frame-ancestors"));
  });
});

/**
 * The bug that actually shipped: frame-ancestors allowed buildhop.io, and a
 * blanket `X-Frame-Options: SAMEORIGIN` in next.config.ts blocked it anyway.
 * Browsers enforce XFO independently, and it has no per-origin allow value, so
 * the only correct move is to omit XFO exactly where frame-ancestors opens up.
 *
 * Both now derive from allowsThirdPartyFraming(), so this asserts the property
 * that matters — they can never disagree again — rather than re-listing paths.
 */
describe("X-Frame-Options and frame-ancestors cannot disagree", () => {
  const PATHS = [
    "/", "/es", "/it", "/pt",
    "/trips/new", "/admin", "/auth/login", "/blog", "/estimate", "/es/blog/x",
  ];

  it.each(PATHS)("%s: XFO is omitted iff buildhop is framed-allowed", (path) => {
    const framingAllowed = allowsThirdPartyFraming(path);
    const fa = directive("frame-ancestors", path);
    const cspAllowsBuildhop = fa.includes("https://buildhop.io");

    // The invariant. If these ever diverge, one of the two headers is lying.
    expect(cspAllowsBuildhop).toBe(framingAllowed);
  });

  it("still sends XFO on authenticated routes — this is not a blanket removal", () => {
    for (const p of ["/trips/new", "/admin", "/auth/login"]) {
      expect(allowsThirdPartyFraming(p)).toBe(false);
    }
  });

  it("opens framing on the landing pages only", () => {
    for (const p of ["/", "/es", "/it", "/pt"]) {
      expect(allowsThirdPartyFraming(p)).toBe(true);
    }
  });
});

/**
 * The BuildHop widget needs BOTH entries, not just script-src — that was
 * exactly the emrldco.com bug (see the connect-src comment above): the
 * script loads and runs fine with only script-src allowed, and then its own
 * fetch() calls get silently refused with nothing to show for it server-side.
 * Present on every route (not homepage-scoped, unlike frame-ancestors) since
 * the widget is meant to be reachable wherever a BuildHop visitor lands.
 */
describe("CSP allows the BuildHop feedback widget to load AND to call home", () => {
  it("allows the script to load from buildhop.io", () => {
    expect(allows(directive("script-src"), "https://buildhop.io/feedback-widget.js")).toBe(true);
  });

  it("allows the script's own requests, not just the script load", () => {
    expect(allows(connectSrc(), "https://buildhop.io/api/feedback")).toBe(true);
  });

  it("is present regardless of route, unlike the homepage-scoped frame-ancestors grant", () => {
    for (const path of ["/", "/trips/new", "/admin", "/blog"]) {
      expect(allows(directive("script-src", path), "https://buildhop.io/feedback-widget.js")).toBe(true);
      expect(allows(directive("connect-src", path), "https://buildhop.io/api/feedback")).toBe(true);
    }
  });
});
