/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  carriesSession,
  classifyPageViewRequest,
  isPageViewPath,
  landingReferrer,
  servedFromSpeculation,
} from "./page-view-classifier";

function req(pathname: string, headers: Record<string, string> = {}, method = "GET") {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, pathname, headers: { get: (n: string) => lower.get(n.toLowerCase()) ?? null } };
}

// What a browser attaches. Next's middleware adapter strips the Flight headers
// (rsc, next-router-*) before the middleware runs, so they are deliberately
// absent from every case: the classifier must work without them.
const NAVIGATION = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" };
const ROUTER_FETCH = { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" };

describe("page-view classifier", () => {
  it("counts a browser navigation", () => {
    expect(classifyPageViewRequest(req("/tools", NAVIGATION))).toBe("counted");
    expect(classifyPageViewRequest(req("/it/trips/new", { ...NAVIGATION, accept: "text/html" }))).toBe("counted");
  });

  it("counts a client that sends no fetch metadata (curl, older engines)", () => {
    expect(classifyPageViewRequest(req("/tools"))).toBe("counted");
  });

  it("skips every router fetch: RSC navigations and Link prefetches look the same here", () => {
    expect(classifyPageViewRequest(req("/explore", ROUTER_FETCH))).toBe("skip:fetch");
    expect(classifyPageViewRequest(req("/explore", { ...ROUTER_FETCH, rsc: "1" }))).toBe("skip:fetch");
    expect(classifyPageViewRequest(req("/blog", { "sec-fetch-dest": "empty" }))).toBe("skip:fetch");
    expect(classifyPageViewRequest(req("/blog", { "sec-fetch-mode": "cors" }))).toBe("skip:fetch");
  });

  it("skips embedded loads (iframe) even though they navigate", () => {
    expect(classifyPageViewRequest(req("/shared/x", { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" }))).toBe("skip:fetch");
  });

  it("skips speculation-rules prefetch and prerender, and the older marker", () => {
    expect(classifyPageViewRequest(req("/tools", { ...NAVIGATION, "sec-purpose": "prefetch;prerender" }))).toBe("skip:prefetch");
    expect(classifyPageViewRequest(req("/tools", { purpose: "prefetch" }))).toBe("skip:prefetch");
  });

  it("skips non-GET requests (HEAD sweeps, server-action POSTs)", () => {
    expect(classifyPageViewRequest(req("/", NAVIGATION, "HEAD"))).toBe("skip:method");
    expect(classifyPageViewRequest(req("/trips/new", { "next-action": "abc" }, "POST"))).toBe("skip:method");
  });

  it("skips API, Next internals, admin and files", () => {
    expect(classifyPageViewRequest(req("/api/consent-event", NAVIGATION))).toBe("skip:path");
    expect(classifyPageViewRequest(req("/_next/data/x", NAVIGATION))).toBe("skip:path");
    expect(classifyPageViewRequest(req("/admin/traffic", NAVIGATION))).toBe("skip:path");
    expect(classifyPageViewRequest(req("/sitemap.xml", NAVIGATION))).toBe("skip:path");
  });

  it("exposes the path rule for the beacon route", () => {
    expect(isPageViewPath("/es/destinations/rome")).toBe(true);
    expect(isPageViewPath("/api/page-view")).toBe(false);
    expect(isPageViewPath("/favicon.ico")).toBe(false);
  });
});

describe("the session cookie", () => {
  it("rides on prefetches and router fetches as well as views", () => {
    // A visitor who clicks a search result Chrome prefetched gets no other
    // response; without the cookie on it their whole visit was session-less.
    expect(carriesSession(classifyPageViewRequest(req("/", { ...NAVIGATION, "sec-purpose": "prefetch" })))).toBe(true);
    expect(carriesSession(classifyPageViewRequest(req("/trips/new", ROUTER_FETCH)))).toBe(true);
    expect(carriesSession(classifyPageViewRequest(req("/tools", NAVIGATION)))).toBe(true);
  });

  it("never rides on API calls, files or non-GET requests", () => {
    expect(carriesSession(classifyPageViewRequest(req("/api/wizard-event", NAVIGATION)))).toBe(false);
    expect(carriesSession(classifyPageViewRequest(req("/sitemap.xml", NAVIGATION)))).toBe(false);
    expect(carriesSession(classifyPageViewRequest(req("/", NAVIGATION, "HEAD")))).toBe(false);
  });
});

describe("landing views the middleware never saw", () => {
  it("recognises a prefetched document and an activated prerender", () => {
    expect(servedFromSpeculation({ deliveryType: "navigational-prefetch", activationStart: 0 })).toBe(true);
    expect(servedFromSpeculation({ deliveryType: "", activationStart: 812.4 })).toBe(true);
  });

  it("leaves ordinary navigations to the middleware", () => {
    expect(servedFromSpeculation({ deliveryType: "", activationStart: 0 })).toBe(false);
    expect(servedFromSpeculation({ deliveryType: "cache" })).toBe(false);
    expect(servedFromSpeculation(undefined)).toBe(false);
  });

  it("keeps the referrer's origin and path only", () => {
    expect(landingReferrer("https://www.google.com/")).toBe("https://www.google.com/");
    expect(landingReferrer("https://example.com/list?email=a@b.c#top")).toBe("https://example.com/list");
    expect(landingReferrer("")).toBeNull();
    expect(landingReferrer("javascript:alert(1)")).toBeNull();
    expect(landingReferrer(42)).toBeNull();
  });
});
