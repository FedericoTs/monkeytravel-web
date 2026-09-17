/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { classifyPageViewRequest } from "./page-view-classifier";

function req(pathname: string, headers: Record<string, string> = {}, method = "GET") {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, pathname, headers: { get: (n: string) => lower.get(n.toLowerCase()) ?? null } };
}

// The exact header sets Next 16.2 sends, copied from node_modules:
//   segment cache prefetch: client/components/segment-cache/cache.js
//   client navigation:      client/components/router-reducer/fetch-server-response.js
const SEGMENT_PREFETCH = { rsc: "1", "next-router-prefetch": "1", "next-router-segment-prefetch": "/_tree" };
const NAVIGATION = { rsc: "1", "next-router-state-tree": "%5B%22%22%2C%7B%7D%5D" };

describe("page-view classifier", () => {
  it("counts a document request", () => {
    expect(classifyPageViewRequest(req("/tools"))).toBe("counted");
    expect(classifyPageViewRequest(req("/it/trips/new", { accept: "text/html" }))).toBe("counted");
  });

  it("counts a client navigation (rsc + router state tree)", () => {
    expect(classifyPageViewRequest(req("/destinations", NAVIGATION))).toBe("counted");
  });

  it("skips a segment-cache prefetch by its named headers", () => {
    expect(classifyPageViewRequest(req("/explore", SEGMENT_PREFETCH))).toBe("skip:prefetch");
    expect(classifyPageViewRequest(req("/explore", { rsc: "1", "next-router-prefetch": "1" }))).toBe("skip:prefetch");
    expect(classifyPageViewRequest(req("/blog", { "Next-Router-Segment-Prefetch": "/_index" }))).toBe("skip:prefetch");
  });

  it("skips the prefetch shape even when Vercel drops the named headers", () => {
    // What production actually saw on 2026-09-17: rsc alone, no tree.
    expect(classifyPageViewRequest(req("/explore", { rsc: "1" }))).toBe("skip:rsc-no-tree");
  });

  it("still honours the older prefetch markers", () => {
    expect(classifyPageViewRequest(req("/tools", { purpose: "prefetch" }))).toBe("skip:prefetch");
    expect(classifyPageViewRequest(req("/tools", { "sec-purpose": "prefetch;prerender" }))).toBe("skip:prefetch");
  });

  it("skips non-GET requests (HEAD sweeps, server-action POSTs)", () => {
    expect(classifyPageViewRequest(req("/", {}, "HEAD"))).toBe("skip:method");
    expect(classifyPageViewRequest(req("/trips/new", { "next-action": "abc" }, "POST"))).toBe("skip:method");
  });

  it("skips API, Next internals, admin and files", () => {
    expect(classifyPageViewRequest(req("/api/consent-event"))).toBe("skip:path");
    expect(classifyPageViewRequest(req("/_next/data/x"))).toBe("skip:path");
    expect(classifyPageViewRequest(req("/admin/traffic"))).toBe("skip:path");
    expect(classifyPageViewRequest(req("/sitemap.xml"))).toBe("skip:path");
  });
});
