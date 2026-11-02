import { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { proxyImage } from "@/lib/api/img-proxy";

// Abuse ceiling for the generic media proxy — generous for real pages,
// hostile to scripted egress/bandwidth abuse.
const imgProxyLimiter = createRateLimiter("img-proxy", 600, 60 * 60 * 1000);

/**
 * GET /api/img/proxy?url=<allowlisted-image-url>
 *
 * The query-string form of the image proxy (lib/api/img-proxy.ts). The app
 * builds the path form, /api/img/proxy/<encoded-url>; this one stays for links
 * already out there.
 */
export async function GET(request: NextRequest) {
  const { allowed } = await imgProxyLimiter.check(request);
  if (!allowed) return new Response("Too many requests", { status: 429 });

  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  return proxyImage(raw);
}
