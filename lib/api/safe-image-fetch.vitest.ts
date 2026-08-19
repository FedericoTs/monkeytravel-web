/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import { safeImageFetch, isInternalHostname, readCapped, imageContentType } from "./safe-image-fetch";

/**
 * The allowlist used to guard only the URL the caller passed in. With
 * redirect:"follow", an allowlisted host answering 302 could hand us any
 * target — off-allowlist or internal — and we would stream it back.
 *
 * The risk in changing this is the opposite one: validating every hop can
 * break legitimate CDN chains. So these tests pin BOTH directions —
 * allowlisted -> allowlisted must still follow, everything else must not.
 */

const EXACT = new Set(["images.pexels.com", "images.unsplash.com", "lh3.googleusercontent.com"]);
// Mirrors app/api/images/proxy's isDomainAllowed (suffix matching).
const SUFFIX = (h: string) =>
  ["googleusercontent.com", "images.unsplash.com"].some(
    (d) => h === d || h.endsWith("." + d)
  );

/** Build a fake fetch that walks a scripted chain of responses by URL. */
function scriptedFetch(chain: Record<string, { status: number; location?: string }>) {
  return vi.fn(async (url: string) => {
    const hop = chain[url];
    if (!hop) throw new Error(`unscripted url: ${url}`);
    return new Response(hop.status >= 300 && hop.status < 400 ? null : "bytes", {
      status: hop.status,
      headers: hop.location ? { location: hop.location } : {},
    });
  });
}

describe("safeImageFetch — legitimate traffic must keep working", () => {
  it("passes through a plain 200 (the dominant pexels/unsplash case)", async () => {
    const f = scriptedFetch({ "https://images.pexels.com/a.jpg": { status: 200 } });
    const r = await safeImageFetch("https://images.pexels.com/a.jpg", {
      allowedHosts: EXACT,
      fetchImpl: f,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.hops).toBe(0);
  });

  it("FOLLOWS a redirect to another allowlisted host", async () => {
    // The requirement most at risk of being broken by this change.
    const f = scriptedFetch({
      "https://images.unsplash.com/x": { status: 302, location: "https://lh3.googleusercontent.com/y" },
      "https://lh3.googleusercontent.com/y": { status: 200 },
    });
    const r = await safeImageFetch("https://images.unsplash.com/x", {
      allowedHosts: EXACT,
      fetchImpl: f,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.finalUrl).toBe("https://lh3.googleusercontent.com/y");
      expect(r.hops).toBe(1);
    }
  });

  it("follows the Google CDN chain under SUFFIX matching (lh5, not just lh3)", async () => {
    // images/proxy matches by suffix, so sibling CDN hosts must still resolve.
    const f = scriptedFetch({
      "https://places.googleusercontent.com/p": { status: 302, location: "https://lh5.googleusercontent.com/q" },
      "https://lh5.googleusercontent.com/q": { status: 200 },
    });
    const r = await safeImageFetch("https://places.googleusercontent.com/p", {
      allowedHosts: SUFFIX,
      fetchImpl: f,
    });
    expect(r.ok).toBe(true);
  });

  it("resolves a RELATIVE Location against the current url", async () => {
    const f = scriptedFetch({
      "https://images.pexels.com/a/b.jpg": { status: 302, location: "/c/d.jpg" },
      "https://images.pexels.com/c/d.jpg": { status: 200 },
    });
    const r = await safeImageFetch("https://images.pexels.com/a/b.jpg", {
      allowedHosts: EXACT,
      fetchImpl: f,
    });
    expect(r.ok).toBe(true);
  });

  it("uses the caller's fetchImpl, so fetchWithRetry keeps working", async () => {
    const f = scriptedFetch({ "https://images.pexels.com/a.jpg": { status: 200 } });
    await safeImageFetch("https://images.pexels.com/a.jpg", { allowedHosts: EXACT, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
    // and it must ask for manual redirects, or the whole exercise is pointless
    expect(f.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
});

describe("safeImageFetch — the hole it closes", () => {
  it("BLOCKS a redirect from an allowlisted host to an off-allowlist host", async () => {
    const f = scriptedFetch({
      "https://images.pexels.com/a.jpg": { status: 302, location: "https://evil.example.com/x" },
    });
    const r = await safeImageFetch("https://images.pexels.com/a.jpg", {
      allowedHosts: EXACT,
      fetchImpl: f,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.reason).toMatch(/blocked redirect.*evil\.example\.com/);
    }
    // and crucially it never fetched the off-allowlist target
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["http://169.254.169.254/latest/meta-data/", "internal"],
    ["https://127.0.0.1/x", "internal"],
    ["https://10.0.0.5/x", "internal"],
    ["https://192.168.1.1/x", "internal"],
    ["https://[::1]/x", "internal"],
    ["https://localhost/x", "internal"],
  ])("BLOCKS a redirect to %s", async (target) => {
    const f = scriptedFetch({
      "https://images.pexels.com/a.jpg": { status: 302, location: target },
    });
    const r = await safeImageFetch("https://images.pexels.com/a.jpg", {
      allowedHosts: EXACT,
      fetchImpl: f,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-https initial url without fetching", async () => {
    const f = scriptedFetch({});
    const r = await safeImageFetch("http://images.pexels.com/a.jpg", {
      allowedHosts: EXACT,
      fetchImpl: f,
    });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("gives up on a redirect loop rather than spinning", async () => {
    const f = scriptedFetch({
      "https://images.pexels.com/a": { status: 302, location: "https://images.pexels.com/b" },
      "https://images.pexels.com/b": { status: 302, location: "https://images.pexels.com/a" },
    });
    const r = await safeImageFetch("https://images.pexels.com/a", {
      allowedHosts: EXACT,
      maxHops: 3,
      fetchImpl: f,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/more than 3 redirects/);
  });

  it("treats a 3xx with no Location as a failure, not a success", async () => {
    const f = scriptedFetch({ "https://images.pexels.com/a": { status: 302 } });
    const r = await safeImageFetch("https://images.pexels.com/a", {
      allowedHosts: EXACT,
      fetchImpl: f,
    });
    expect(r.ok).toBe(false);
  });
});

describe("isInternalHostname", () => {
  it.each([
    "localhost", "app.localhost", "127.0.0.1", "10.1.2.3", "192.168.0.1",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "0.0.0.0", "[::1]", "::1",
  ])("flags %s", (h) => expect(isInternalHostname(h)).toBe(true));

  it.each([
    "images.pexels.com", "lh3.googleusercontent.com", "images.unsplash.com",
    // 172.15/172.32 sit OUTSIDE the private range — must not be over-blocked
    "172.15.0.1", "172.32.0.1",
    // hosts that merely start with the digits of a private range
    "10x.example.com", "127-foo.example.com",
  ])("allows %s", (h) => expect(isInternalHostname(h)).toBe(false));
});

/**
 * readCapped / imageContentType — the size and type gates for the BUFFERING
 * proxy (app/api/images/proxy), which had neither.
 *
 * These run against real Response objects backed by real ReadableStreams, not
 * mocks, because the whole point of readCapped is its streaming behaviour: a
 * Content-Length check alone is not enough, since the header is absent on
 * chunked responses and an upstream is free to lie about it.
 */

/** Response whose body is delivered in `chunks`, counting how many were pulled. */
function streamResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {}
): { response: Response; pulled: () => number } {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls < chunks.length) {
        controller.enqueue(chunks[pulls]);
        pulls += 1;
      } else {
        controller.close();
      }
    },
  });
  return {
    response: new Response(stream, { headers }),
    pulled: () => pulls,
  };
}

const kb = (n: number) => new Uint8Array(n * 1024).fill(65);

describe("readCapped — size gate", () => {
  it("returns the full body when under the cap", async () => {
    const { response } = streamResponse([kb(1), kb(1)]);
    const buf = await readCapped(response, 10 * 1024);
    expect(buf).not.toBeNull();
    expect(buf!.length).toBe(2048);
  });

  it("accepts a body EXACTLY at the cap (boundary is inclusive)", async () => {
    const { response } = streamResponse([new Uint8Array(100).fill(1)]);
    const buf = await readCapped(response, 100);
    expect(buf).not.toBeNull();
    expect(buf!.length).toBe(100);
  });

  it("rejects a body ONE byte over the cap", async () => {
    const { response } = streamResponse([new Uint8Array(101).fill(1)]);
    expect(await readCapped(response, 100)).toBeNull();
  });

  it("STOPS EARLY instead of draining a hostile body", async () => {
    // 100 chunks of 1KB, cap at 2KB — must abort after ~3 pulls, not 100.
    const chunks = Array.from({ length: 100 }, () => kb(1));
    const { response, pulled } = streamResponse(chunks);
    expect(await readCapped(response, 2 * 1024)).toBeNull();
    expect(pulled()).toBeLessThan(5);
  });

  it("caps a body with NO content-length (the chunked case a header check misses)", async () => {
    const { response } = streamResponse([kb(50), kb(50)]);
    expect(response.headers.get("content-length")).toBeNull();
    expect(await readCapped(response, 10 * 1024)).toBeNull();
  });

  it("caps a body whose content-length LIES about being small", async () => {
    // The reason the cap is enforced during the read rather than from the header.
    const { response } = streamResponse([kb(500)], { "content-length": "10" });
    expect(await readCapped(response, 100 * 1024)).toBeNull();
  });

  it("returns an empty buffer for an empty body, not null", async () => {
    const { response } = streamResponse([]);
    const buf = await readCapped(response, 1024);
    expect(buf).not.toBeNull();
    expect(buf!.length).toBe(0);
  });

  it("returns null when there is no body at all", async () => {
    expect(await readCapped(new Response(null, { status: 204 }), 1024)).toBeNull();
  });

  it("preserves the exact bytes it read", async () => {
    const payload = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const { response } = streamResponse([payload]);
    const buf = await readCapped(response, 1024);
    expect(Array.from(buf!)).toEqual(Array.from(payload));
  });
});

describe("imageContentType — type gate", () => {
  const withType = (ct?: string) =>
    new Response("x", { headers: ct ? { "content-type": ct } : {} });

  it.each(["image/jpeg", "image/png", "image/webp", "image/avif"])(
    "accepts %s",
    (ct) => expect(imageContentType(withType(ct))).toBe(ct)
  );

  it("accepts a parameterised image type", () => {
    expect(imageContentType(withType("image/svg+xml; charset=utf-8")))
      .toBe("image/svg+xml; charset=utf-8");
  });

  it.each(["text/html", "application/json", "text/plain", "application/pdf"])(
    "REJECTS %s — this is the gap: such a body used to be base64ed and cached as a photo",
    (ct) => expect(imageContentType(withType(ct))).toBeNull()
  );

  it("falls back to image/jpeg when the header is absent", () => {
    // Deliberate, and matches the sibling proxies: some CDNs omit the header on
    // valid images, and hard-requiring it would break them.
    const r = new Response("x");
    r.headers.delete("content-type");
    expect(imageContentType(r)).toBe("image/jpeg");
  });
});
