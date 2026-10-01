import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://monkeytravel.app";
const TRIP_ID = "0b6f2d1e-8c4a-4f3b-9d2e-7a5c1e9f4b30";

/** Runs public/sw.js against stubs and reports whether it answers the GET itself. */
function servedByWorker(path: string): boolean {
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const cache = { match: async () => undefined, put: async () => {} };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  const fetch = async () => ({ ok: true, status: 200, clone: () => ({}) });
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  new Function("self", "caches", "fetch", source)(self, caches, fetch);

  let answered = false;
  listeners.fetch({
    request: { method: "GET", url: `${ORIGIN}${path}` },
    respondWith: () => {
      answered = true;
    },
  });
  return answered;
}

describe("the service worker's trip cache", () => {
  it("never answers for the planner, whose cached copy would run old code", () => {
    expect(servedByWorker("/trips/new")).toBe(false);
    expect(servedByWorker("/es/trips/new")).toBe(false);
    expect(servedByWorker("/trips/new?destination=Tokyo")).toBe(false);
  });

  it("still keeps saved trips readable offline", () => {
    expect(servedByWorker(`/trips/${TRIP_ID}`)).toBe(true);
    expect(servedByWorker(`/pt/trips/${TRIP_ID}/edit`)).toBe(true);
    expect(servedByWorker(`/api/trips/${TRIP_ID}`)).toBe(true);
  });

  it("leaves other pages to the network", () => {
    expect(servedByWorker("/trips")).toBe(false);
    expect(servedByWorker("/trips/template")).toBe(false);
  });
});
