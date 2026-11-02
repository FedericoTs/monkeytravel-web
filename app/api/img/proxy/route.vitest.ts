/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The image proxy answers the same way whether the image URL comes as
 * ?url= or as an encoded path segment: these run every case through both
 * routes. Upstream fetches are scripted; nothing leaves the process.
 */

const upstream = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
vi.mock("@/lib/api/fetch-with-one-retry", () => ({
  fetchWithOneRetry: (url: string, init: RequestInit) => upstream(url, init),
}));
const allowed = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: allowed.value, remaining: 0 }) }),
}));

import { GET as byQuery } from "./route";
import { GET as byPath } from "./[token]/route";
import { proxyImageUrl } from "@/lib/img/proxyUrl";

const PEXELS = "https://images.pexels.com/photos/1/a.jpeg?w=600";

function viaQuery(url: string) {
  return byQuery(new NextRequest(`https://monkeytravel.app/api/img/proxy?url=${encodeURIComponent(url)}`));
}
function viaPath(url: string, token = encodeURIComponent(url)) {
  return byPath(new NextRequest(`https://monkeytravel.app/api/img/proxy/${token}`), {
    params: Promise.resolve({ token }),
  });
}
const ROUTES = [
  ["?url=", viaQuery],
  ["path", viaPath],
] as const;

const image = (body: string, headers: Record<string, string>, status = 200) =>
  new Response(body, { status, headers });

async function answer(res: Response) {
  return {
    status: res.status,
    body: await res.text(),
    type: res.headers.get("content-type"),
    cache: res.headers.get("cache-control"),
    proxied: res.headers.get("x-image-proxy"),
  };
}

beforeEach(() => {
  upstream.mockReset();
  allowed.value = true;
});

describe.each(ROUTES)("the image proxy, URL by %s", (_, get) => {
  it("streams an allowlisted image back with long cache headers", async () => {
    upstream.mockResolvedValue(image("png-bytes", { "content-type": "image/png", "content-length": "9" }));
    expect(await answer(await get(PEXELS))).toEqual({
      status: 200,
      body: "png-bytes",
      type: "image/png",
      cache: "public, max-age=2592000, s-maxage=31536000, immutable",
      proxied: "1",
    });
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(PEXELS);
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("user-agent")).toBe("MonkeyTravelImageProxy/1.0 (+https://monkeytravel.app)");
    expect(new Headers(init.headers).get("accept")).toBe("image/*");
  });

  it("labels an untyped image as JPEG", async () => {
    upstream.mockResolvedValue(new Response(new Blob(["jpeg-bytes"]), { status: 200 }));
    const res = await get(PEXELS);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it.each([
    ["not a URL", "nope", "Invalid url"],
    ["plain http", "http://images.pexels.com/a.jpg", "Only https allowed"],
    ["a host off the list", "https://example.com/a.jpg", "Host not allowed"],
    ["an internal address", "https://169.254.169.254/latest", "Host not allowed"],
  ])("refuses %s before fetching anything", async (_case, url, reason) => {
    expect(await answer(await get(url))).toMatchObject({ status: 400, body: reason });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a redirect off the list", async () => {
    upstream.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/x.jpg" } }));
    const res = await answer(await get(PEXELS));
    expect(res.status).toBe(403);
    expect(res.body).toMatch(/^blocked redirect to /);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("passes an upstream failure through", async () => {
    upstream.mockResolvedValue(new Response("gone", { status: 404 }));
    expect(await answer(await get(PEXELS))).toMatchObject({ status: 404, body: "Upstream 404" });
  });

  it("refuses an image over 10 MB by its declared length", async () => {
    upstream.mockResolvedValue(image("x", { "content-type": "image/jpeg", "content-length": String(10 * 1024 * 1024 + 1) }));
    expect(await answer(await get(PEXELS))).toMatchObject({ status: 413, body: "Payload too large" });
  });

  it("takes an image of exactly 10 MB, or with no usable length", async () => {
    upstream.mockResolvedValueOnce(image("x", { "content-type": "image/jpeg", "content-length": String(10 * 1024 * 1024) }));
    expect((await get(PEXELS)).status).toBe(200);
    upstream.mockResolvedValueOnce(image("x", { "content-type": "image/jpeg", "content-length": "lots" }));
    expect((await get(PEXELS)).status).toBe(200);
  });

  it("refuses a body that is not an image", async () => {
    upstream.mockResolvedValue(image("<html>", { "content-type": "text/html" }));
    expect(await answer(await get(PEXELS))).toMatchObject({ status: 415, body: "Non-image content-type" });
  });

  it("stops at the rate limit", async () => {
    allowed.value = false;
    expect(await answer(await get(PEXELS))).toMatchObject({ status: 429, body: "Too many requests" });
    expect(upstream).not.toHaveBeenCalled();
  });
});

it("?url= without a url is a 400", async () => {
  const res = await byQuery(new NextRequest("https://monkeytravel.app/api/img/proxy"));
  expect(await answer(res)).toMatchObject({ status: 400, body: "Missing url" });
});

it("a path that does not decode is a 400", async () => {
  expect(await answer(await viaPath("", "%E0%A4%A"))).toMatchObject({ status: 400, body: "Invalid token encoding" });
});

it("takes every image URL lib/img/proxyUrl.ts sends its way", async () => {
  for (const url of [PEXELS, "https://images.unsplash.com/photo-1?w=600"]) {
    const src = proxyImageUrl(url)!;
    expect(src.startsWith("/api/img/proxy/")).toBe(true);
    upstream.mockResolvedValueOnce(image("x", { "content-type": "image/jpeg" }));
    expect((await viaPath(url, src.slice("/api/img/proxy/".length))).status).toBe(200);
  }
});
