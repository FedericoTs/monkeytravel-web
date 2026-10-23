/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Stored Wikimedia photos are served from the private bucket with a cache
 * header the CDN keeps for a year; anything that is not a stored file is 404.
 */

const downloads: string[] = [];
let stored = true;
vi.mock("@/lib/supabase/cache-admin", () => ({
  cacheAdminDb: () => ({
    storage: {
      from: () => ({
        download: async (path: string) => {
          downloads.push(path);
          return stored ? { data: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), error: null } : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
  }),
}));

const { GET } = await import("./route");
const get = (file: string) => GET(new NextRequest(`http://localhost/api/images/wikimedia/${file}`), { params: Promise.resolve({ file }) });

beforeEach(() => {
  downloads.length = 0;
  stored = true;
});

describe("GET /api/images/wikimedia/[file]", () => {
  it("serves a stored photo for the CDN to keep", async () => {
    const res = await get("0123456789abcdef0123-1920.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("s-maxage=31536000");
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(downloads).toEqual(["wikimedia/0123456789abcdef0123-1920.jpg"]);
  });

  it("serves an activity's card copy", async () => {
    const res = await get("0123456789abcdef0123-500.jpg");
    expect(res.status).toBe(200);
    expect(downloads).toEqual(["wikimedia/0123456789abcdef0123-500.jpg"]);
  });

  it("answers 404 for anything else, without reading storage", async () => {
    for (const file of ["../outside.jpg", "0123456789abcdef0123-800.jpg", "0123456789abcdef0123-1920.png", "x.jpg"]) {
      expect((await get(file)).status, file).toBe(404);
    }
    expect(downloads).toEqual([]);
  });

  it("answers 404, briefly cached, when the file is not stored", async () => {
    stored = false;
    const res = await get("0123456789abcdef0123-330.jpg");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });
});
