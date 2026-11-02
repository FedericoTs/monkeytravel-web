import { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { proxyImage } from "@/lib/api/img-proxy";

// Shares the same abuse posture as /api/img/proxy (query variant).
const imgProxyTokenLimiter = createRateLimiter(
  "img-proxy-token",
  600,
  60 * 60 * 1000,
);

/**
 * GET /api/img/proxy/<encoded-url>
 *
 * The image proxy (lib/api/img-proxy.ts), with the image URL encoded into
 * the path: lib/img/proxyUrl.ts builds these.
 *
 * **A path segment, not `?url=`:** Next.js 16 requires
 * `images.localPatterns` to allow-list query strings on local
 * `<Image src=...>` URLs, and the `search` field only accepts an
 * exact string — no wildcards — so `?url=<varies>` is unrepresentable
 * in config. The URL in a path segment makes this route
 * compatible with both `<Image>` and plain `<img>` everywhere, AND
 * keeps Next image optimization on the proxied bytes (which improves
 * LCP and saves bandwidth vs. shipping the raw upstream JPEG).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { allowed } = await imgProxyTokenLimiter.check(request);
  if (!allowed) return new Response("Too many requests", { status: 429 });

  const { token } = await params;
  if (!token) return new Response("Missing token", { status: 400 });

  let raw: string;
  try {
    raw = decodeURIComponent(token);
  } catch {
    return new Response("Invalid token encoding", { status: 400 });
  }

  return proxyImage(raw);
}
