/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { buildCspHeader } from "./csp";

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

function connectSrc(): string[] {
  const header = buildCspHeader("test-nonce");
  const directive = header.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
  expect(directive, "connect-src missing from the CSP").toBeTruthy();
  return directive!.split(/\s+/).slice(1);
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
