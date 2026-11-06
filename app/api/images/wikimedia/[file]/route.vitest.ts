/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A Wikimedia photo comes from Commons, by the file name in the URL's credit, with
 * a cache header the CDN keeps for a year. A stored copy stands in when Commons
 * can't serve it. Failing is never cached for long, and only a known file is fetched.
 */

const s = vi.hoisted(() => ({ downloads: [] as string[], stored: true, allowed: true }));
vi.mock("@/lib/supabase/cache-admin", () => ({
  cacheAdminDb: () => ({
    storage: {
      from: () => ({
        download: async (path: string) => {
          s.downloads.push(path);
          return s.stored ? { data: new Blob([new Uint8Array([0xee, 0xee])]), error: null } : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: s.allowed }) }),
}));

const { commonsPhotoId } = await import("@/lib/images/wikimedia");
const { GET } = await import("./route");

const NAME = "Valletta St Johns square Malta 2014 3.jpg";
const ID = commonsPhotoId(NAME);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);

const get = (file: string, query = `?a=Karelj&l=Public+domain&f=${encodeURIComponent(NAME)}`) =>
  GET(new NextRequest(`https://monkeytravel.app/api/images/wikimedia/${file}${query}`), { params: Promise.resolve({ file }) });

const commons = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const answers = (status: number, type = "image/jpeg") =>
  commons.mockResolvedValue(new Response(status === 200 ? JPEG : "no", { status, headers: { "content-type": type } }));

beforeEach(() => {
  s.downloads.length = 0;
  s.stored = true;
  s.allowed = true;
  commons.mockReset();
  answers(200);
  vi.stubGlobal("fetch", commons);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/images/wikimedia/[file]", () => {
  it("serves the photo from Commons for the CDN to keep, without reading storage", async () => {
    const res = await get(`${ID}-1920.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("s-maxage=31536000");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(s.downloads).toEqual([]);
  });

  it("asks Commons for that file at that width, saying who's asking", async () => {
    await get(`${ID}-500.jpg`);
    const [url, init] = commons.mock.calls[0];
    expect(url).toBe("https://commons.wikimedia.org/wiki/Special:FilePath/Valletta_St_Johns_square_Malta_2014_3.jpg?width=500");
    expect(new Headers(init?.headers).get("user-agent")).toContain("MonkeyTravel");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("answers 404 for anything else, without reading storage or asking Commons", async () => {
    for (const file of ["../outside.jpg", `${ID}-800.jpg`, `${ID}-1920.png`, "x.jpg", `${ID}1-500.jpg`]) {
      expect((await get(file)).status, file).toBe(404);
    }
    expect(s.downloads).toEqual([]);
    expect(commons).not.toHaveBeenCalled();
  });

  it.each([
    ["no file name", ""],
    ["another file's name", "?f=Some+other+photo.jpg"],
  ])("doesn't ask Commons with %s: the stored copy answers", async (_name, query) => {
    const res = await get(`${ID}-500.jpg`, query);
    expect(commons).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xee, 0xee]));
    expect(s.downloads).toEqual([`wikimedia/${ID}-500.jpg`]);
  });

  it.each([
    ["refuses", () => answers(429)],
    ["fails", () => answers(500)],
    ["no longer has the file", () => answers(404)],
    ["answers with a page, not a photo", () => answers(200, "text/html")],
    ["can't be reached", () => commons.mockRejectedValue(new Error("timeout"))],
  ])("serves the stored copy when Commons %s", async (_name, setUp) => {
    setUp();
    const res = await get(`${ID}-960.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=31536000");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xee, 0xee]));
  });

  it("answers 404, briefly cached, when Commons doesn't have it and nothing is stored", async () => {
    s.stored = false;
    answers(404);
    const res = await get(`${ID}-330.jpg`);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it.each([
    ["refuses", () => answers(429)],
    ["can't be reached", () => commons.mockRejectedValue(new Error("timeout"))],
  ])("keeps nothing in the CDN, and says so in the logs, when Commons %s and nothing is stored", async (_name, setUp) => {
    s.stored = false;
    setUp();
    const res = await get(`${ID}-330.jpg`);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(console.error).toHaveBeenCalled();
  });

  it("stops one address asking for too many, before asking Commons", async () => {
    s.allowed = false;
    const res = await get(`${ID}-500.jpg`);
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(commons).not.toHaveBeenCalled();
    expect(s.downloads).toEqual([]);
  });
});
