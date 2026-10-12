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

type WorkerOptions = {
  cached?: Res;
  network?: () => Promise<Res>;
  /** The request's mode: "navigate" for a page load, "cors" for a fetch() from the page. */
  mode?: string;
  /** What the browser preloaded for this navigation (undefined: nothing). */
  preload?: Res;
  /** Whether this browser has navigation preload at all. */
  preloadSupported?: boolean;
};

/** Loads public/sw.js against stubs and returns its event listeners plus what it touched. */
function loadWorker(opts: WorkerOptions = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const enabled: boolean[] = [];
  const claimed: boolean[] = [];
  const self = {
    location: { origin: ORIGIN },
    registration:
      opts.preloadSupported === false ? {} : { navigationPreload: { enable: async () => void enabled.push(true) } },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: async () => void claimed.push(true) },
  };
  const puts: string[] = [];
  const deletes: string[] = [];
  const fetched: string[] = [];
  const cache = {
    match: async () => opts.cached,
    put: async (req: { url: string }) => void puts.push(req.url),
    delete: async (req: { url: string }) => deletes.push(req.url) > 0,
  };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  const fetch = async (req: { url: string }) => {
    fetched.push(req.url);
    return (opts.network ?? (async () => res("network")))();
  };
  class StubResponse {
    constructor(public body: string, public init: { status: number }) {}
  }
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  new Function("self", "caches", "fetch", "Response", source)(self, caches, fetch, StubResponse);
  return { listeners, puts, deletes, fetched, enabled, claimed };
}

/** Runs public/sw.js against stubs and reports what it does with one GET. */
function runWorker(path: string, opts: WorkerOptions = {}) {
  const worker = loadWorker(opts);
  let answer: Promise<unknown> | null = null;
  worker.listeners.fetch({
    request: { method: "GET", url: `${ORIGIN}${path}`, mode: opts.mode ?? "navigate" },
    preloadResponse: Promise.resolve(opts.preload),
    respondWith: (p: Promise<unknown>) => {
      answer = p;
    },
  });
  return { ...worker, answer: answer as Promise<unknown> | null };
}

const servedByWorker = (path: string, opts: WorkerOptions = {}) => runWorker(path, opts).answer !== null;

describe("the service worker's trip cache", () => {
  it("never serves the planner from a cache, whose copy would run old code", async () => {
    for (const path of ["/trips/new", "/es/trips/new", "/trips/new?destination=Tokyo"]) {
      const run = runWorker(path, { cached: res("cached"), preload: res("preloaded") });
      expect(await run.answer).toMatchObject({ tag: "preloaded" });
      expect(run.puts).toEqual([]);
      expect(servedByWorker(path, { preloadSupported: false })).toBe(false);
    }
  });

  it("still keeps saved trips readable offline", () => {
    expect(servedByWorker(`/trips/${TRIP_ID}`)).toBe(true);
    expect(servedByWorker(`/pt/trips/${TRIP_ID}/edit`)).toBe(true);
    expect(servedByWorker(`/api/trips/${TRIP_ID}`, { mode: "cors" })).toBe(true);
  });

  it("leaves other pages to the network", async () => {
    for (const path of ["/trips", "/trips/template"]) {
      const run = runWorker(path, { cached: res("cached"), preload: res("preloaded") });
      expect(await run.answer).toMatchObject({ tag: "preloaded" });
      expect(run.puts).toEqual([]);
      expect(servedByWorker(path, { preloadSupported: false })).toBe(false);
    }
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
      mode: "cors",
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

describe("navigation preload", () => {
  it("is turned on when the worker activates", async () => {
    const worker = loadWorker();
    let done: Promise<unknown> = Promise.resolve();
    worker.listeners.activate({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect(worker.enabled).toEqual([true]);
    expect(worker.claimed).toEqual([true]);
  });

  it("answers a page with the response the browser preloaded, without asking again", async () => {
    for (const path of ["/trips/new", "/trips", "/auth/callback?code=abc", "/admin", "/"]) {
      const run = runWorker(path, { preload: res("preloaded") });
      expect(await run.answer).toMatchObject({ tag: "preloaded" });
      expect(run.fetched).toEqual([]);
      expect(run.puts).toEqual([]);
    }
  });

  it("answers a trip page with its preloaded response and keeps that for offline", async () => {
    const run = runWorker(`/trips/${TRIP_ID}`, { preload: res("preloaded") });
    expect(await run.answer).toMatchObject({ tag: "preloaded" });
    expect(run.fetched).toEqual([]);
    expect(run.puts).toEqual([`${ORIGIN}/trips/${TRIP_ID}`]);
  });

  it("still keeps the copy when the preloaded trip page fails offline", async () => {
    const worker = loadWorker({ cached: res("cached") });
    let answer: Promise<unknown> | null = null;
    worker.listeners.fetch({
      request: { method: "GET", url: `${ORIGIN}/trips/${TRIP_ID}`, mode: "navigate" },
      preloadResponse: Promise.reject(new TypeError("Failed to fetch")),
      respondWith: (p: Promise<unknown>) => {
        answer = p;
      },
    });
    expect(await answer).toMatchObject({ tag: "cached" });
  });

  it("requests the page itself when nothing was preloaded", async () => {
    const run = runWorker("/trips/new", { network: async () => res("fresh") });
    expect(await run.answer).toMatchObject({ tag: "fresh" });
    expect(run.fetched).toEqual([`${ORIGIN}/trips/new`]);
  });
});
