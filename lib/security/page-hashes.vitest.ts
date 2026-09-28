/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { forgetPageScriptHashes, inlineScriptHashes, pageScriptHashes, PROBE_HEADER } from "./page-hashes";

const sha = (s: string) => `sha256-${createHash("sha256").update(s, "utf8").digest("base64")}`;

describe("inlineScriptHashes: exactly the scripts a browser would execute", () => {
  it("hashes inline JavaScript, in whatever type spelling Next emits", async () => {
    const html = `<script>self.__next_f.push([1,"a"])</script><script type="text/javascript">b()</script><script type="module">c()</script>`;
    expect(await inlineScriptHashes(html)).toEqual([sha('self.__next_f.push([1,"a"])'), sha("b()"), sha("c()")].sort());
  });

  it("skips external scripts, data blocks and empty tags", async () => {
    const html =
      `<script src="/_next/static/chunks/x.js" async></script>` +
      `<script type="application/ld+json">{"@context":"https://schema.org"}</script>` +
      `<script type="application/json" id="__NEXT_DATA__">{}</script>` +
      `<script></script>`;
    expect(await inlineScriptHashes(html)).toEqual([]);
  });

  it("hashes the exact bytes between the tags and lists each once", async () => {
    const body = ` if (a < b) { x = "y" } \n`;
    expect(await inlineScriptHashes(`<script>${body}</script><script>${body}</script>`)).toEqual([sha(body)]);
  });
});

describe("pageScriptHashes: one probe per path, verdict remembered", () => {
  const fetchMock = vi.fn();
  const staticHtml = `<html><head><script>self.__next_f.push([0])</script></head><body></body></html>`;
  const noncedHtml = `<html><head><script nonce="abc">self.__next_f.push([0])</script></head></html>`;

  beforeEach(() => {
    forgetPageScriptHashes();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const respond = (html: string, headers: Record<string, string>, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(html, { status, headers }));

  it("fetches the page bare, with the probe header, and pins its inline scripts", async () => {
    respond(staticHtml, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" });
    const req = new NextRequest("https://example.com/blog", { headers: { cookie: "_vercel_jwt=abc; sb-auth-token=secret" } });
    expect(await pageScriptHashes(req)).toEqual([sha("self.__next_f.push([0])")]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://example.com/blog");
    expect(init.headers[PROBE_HEADER]).toBe("1");
    // The visitor's Vercel cookie opens a protected preview; nothing else travels.
    expect(init.headers.cookie).toBe("_vercel_jwt=abc");
    expect(init.redirect).toBe("manual");
  });

  it("remembers the verdict and dedupes concurrent probes", async () => {
    respond(staticHtml, { "content-type": "text/html", "cache-control": "public" });
    const req = new NextRequest("https://example.com/it/blog");
    const [a, b] = await Promise.all([pageScriptHashes(req), pageScriptHashes(req)]);
    expect(a).toEqual(b);
    await pageScriptHashes(req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a per-request page as null when the HTML carries a nonce or the cache is private", async () => {
    respond(noncedHtml, { "content-type": "text/html", "cache-control": "private, no-store" });
    expect(await pageScriptHashes(new NextRequest("https://example.com/trips/new"))).toBeNull();
    respond(staticHtml, { "content-type": "text/html", "cache-control": "private, no-cache, no-store" });
    expect(await pageScriptHashes(new NextRequest("https://example.com/explore"))).toBeNull();
  });

  it("reports null for a 404 or a redirect instead of pinning an error page", async () => {
    respond("<html>not found</html>", { "content-type": "text/html", "cache-control": "public" }, 404);
    expect(await pageScriptHashes(new NextRequest("https://example.com/blog/nope"))).toBeNull();
    respond("", { location: "/it/blog" }, 307);
    expect(await pageScriptHashes(new NextRequest("https://example.com/en/blog"))).toBeNull();
  });

  it("lets a failed probe throw so the caller can degrade explicitly", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(pageScriptHashes(new NextRequest("https://example.com/blog"))).rejects.toThrow("network down");
    // A failure is not remembered: the next request probes again.
    respond(staticHtml, { "content-type": "text/html", "cache-control": "public" });
    expect(await pageScriptHashes(new NextRequest("https://example.com/blog"))).toHaveLength(1);
  });
});
