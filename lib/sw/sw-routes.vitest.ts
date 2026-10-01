import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://monkeytravel.app";
const TRIP_ID = "0b6f2d1e-8c4a-4f3b-9d2e-7a5c1e9f4b30";

type Res = { ok: boolean; status: number; type: string; tag: string; clone: () => Res };
const res = (tag: string, status = 200, type = "basic"): Res => {
  const r: Res = { ok: status >= 200 && status < 300, status, type, tag, clone: () => r };
  return r;
};

/** Runs public/sw.js against stubs and reports what it does with one GET. */
function runWorker(path: string, opts: { cached?: Res; network?: () => Promise<Res> } = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const puts: string[] = [];
  const deletes: string[] = [];
  const cache = {
    match: async () => opts.cached,
    put: async (req: { url: string }) => void puts.push(req.url),
    delete: async (req: { url: string }) => deletes.push(req.url) > 0,
  };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  const fetch = opts.network ?? (async () => res("network"));
  class StubResponse {
    constructor(public body: string, public init: { status: number }) {}
  }
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  new Function("self", "caches", "fetch", "Response", source)(self, caches, fetch, StubResponse);

  let answer: Promise<unknown> | null = null;
  listeners.fetch({
    request: { method: "GET", url: `${ORIGIN}${path}` },
    respondWith: (p: Promise<unknown>) => {
      answer = p;
    },
  });
  return { answer: answer as Promise<unknown> | null, puts, deletes };
}

const servedByWorker = (path: string) => runWorker(path).answer !== null;

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

describe("a trip page goes to the network first", () => {
  it("shows the server's page when online, and keeps it for offline", async () => {
    const run = runWorker(`/trips/${TRIP_ID}`, { cached: res("cached"), network: async () => res("fresh") });
    expect(await run.answer).toMatchObject({ tag: "fresh" });
    expect(run.puts).toEqual([`${ORIGIN}/trips/${TRIP_ID}`]);
  });

  it("falls back to the kept copy when offline", async () => {
    const run = runWorker(`/api/trips/${TRIP_ID}/activities`, {
      cached: res("cached"),
      network: async () => Promise.reject(new TypeError("Failed to fetch")),
    });
    expect(await run.answer).toMatchObject({ tag: "cached" });
  });

  it("drops the kept copy when the server sends the visitor elsewhere", async () => {
    const run = runWorker(`/trips/${TRIP_ID}`, {
      cached: res("cached"),
      network: async () => res("sign-in redirect", 0, "opaqueredirect"),
    });
    expect(await run.answer).toMatchObject({ tag: "sign-in redirect" });
    expect(run.deletes).toEqual([`${ORIGIN}/trips/${TRIP_ID}`]);
    expect(run.puts).toEqual([]);
  });
});
