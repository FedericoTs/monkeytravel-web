import { NextRequest, NextResponse } from "next/server";
import { cacheAdminDb } from "@/lib/supabase/cache-admin";
import crypto from "crypto";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { safeImageFetch, readCapped, imageContentType, MAX_IMAGE_BYTES } from "@/lib/api/safe-image-fetch";

// Cache TTL: 30 days (Google Places images are stable)
const IMAGE_CACHE_DAYS = 30;


// 600/hour/IP — this route is auth-gated but was otherwise uncapped, and POST
// fans out up to 20 upstream image fetches per call, so a single logged-in
// user could drive real egress/bandwidth cost. 600/hr is far above any honest
// UI usage (matches the sibling places/photo + img/proxy limiters). Distinct
// namespace from the "img-proxy" route so their buckets don't collide.
const imageProxyLimiter = createRateLimiter("images-proxy", 600, 60 * 60 * 1000);

// Shared allowed domains (extracted to avoid duplication)
const ALLOWED_DOMAINS = [
  "maps.googleapis.com",
  "lh3.googleusercontent.com",
  "lh5.googleusercontent.com",
  "streetviewpixels-pa.googleapis.com",
  "images.unsplash.com",
  "source.unsplash.com",
  "places.googleapis.com",
  "googleusercontent.com",
];

/**
 * Generate cache key for image URL
 */
function getImageCacheKey(imageUrl: string): string {
  return crypto.createHash("md5").update(imageUrl).digest("hex");
}

/**
 * Check cache for existing base64 image
 */
async function getCachedImage(cacheKey: string): Promise<{ dataUrl: string; contentType: string } | null> {
  try {
    // Service role: see lib/supabase/cache-admin.ts. Null means no
    // service key — treat as a cache miss rather than throwing.
    const db = cacheAdminDb();
    if (!db) return null;

    const { data, error } = await db
      .from("google_places_cache")
      .select("*")
      .eq("place_id", `img:${cacheKey}`)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) return null;

    // Update hit count (fire and forget)
    db
      .from("google_places_cache")
      .update({
        hit_count: (data.hit_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .then(() => {});

    const cacheData = data.data as { dataUrl: string; contentType: string };
    return cacheData;
  } catch {
    return null;
  }
}

/**
 * Save image to cache
 */
async function cacheImage(cacheKey: string, dataUrl: string, contentType: string, originalUrl: string): Promise<void> {
  try {
    const db = cacheAdminDb();
    if (!db) return;

    const expiresAt = new Date(Date.now() + IMAGE_CACHE_DAYS * 24 * 60 * 60 * 1000);

    await db.from("google_places_cache").upsert(
      {
        place_id: `img:${cacheKey}`,
        cache_type: "image_base64",
        data: { dataUrl, contentType, originalUrl, size: dataUrl.length },
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "place_id" }
    );
  } catch (error) {
    console.error("[Image Cache] Save error:", error);
  }
}

/**
 * Check if domain is allowed
 */
function isDomainAllowed(hostname: string): boolean {
  return ALLOWED_DOMAINS.some(domain =>
    hostname === domain || hostname.endsWith("." + domain)
  );
}

/**
 * Image proxy API to fetch external images and return as base64
 * This bypasses CORS restrictions for PDF generation
 *
 * CACHING: Uses Supabase cache for 30-day TTL to reduce bandwidth
 */
export async function GET(request: NextRequest) {
  // Require authentication to prevent open proxy abuse
  const { errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  const { allowed } = await imageProxyLimiter.check(request);
  if (!allowed) return errors.rateLimit("Too many image requests");

  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return errors.badRequest("Missing url parameter");
  }

  try {
    // Decode the URL if it was encoded
    const decodedUrl = decodeURIComponent(imageUrl);

    // Validate URL
    const url = new URL(decodedUrl);

    // Enforce HTTPS
    if (url.protocol !== "https:") {
      return errors.badRequest("Only HTTPS URLs are allowed");
    }

    // Reject private/internal IP ranges
    const hostname = url.hostname;
    if (
      hostname === "localhost" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === "0.0.0.0" ||
      hostname === "[::1]"
    ) {
      return errors.forbidden("Internal addresses are not allowed");
    }

    if (!isDomainAllowed(url.hostname)) {
      return errors.forbidden(`Domain not allowed: ${url.hostname}`);
    }

    // Check cache first (30-day TTL for images)
    const cacheKey = getImageCacheKey(decodedUrl);
    const cachedImage = await getCachedImage(cacheKey);

    if (cachedImage) {
      console.log(`[Image Proxy] Cache HIT for ${url.hostname}`);
      return apiSuccess({
        success: true,
        dataUrl: cachedImage.dataUrl,
        contentType: cachedImage.contentType,
        cached: true,
      });
    }

    console.log(`[Image Proxy] Cache MISS for ${url.hostname}`);

    // Fetch the image. The allowlist and internal-address checks above only
    // guarded the URL the caller supplied; this re-applies both to every
    // redirect target, since fetch's default redirect:"follow" would otherwise
    // have carried us off-allowlist on a 302 from an allowlisted host.
    // isDomainAllowed is passed as a predicate so the suffix matching this
    // route relies on (e.g. any *.googleusercontent.com) is preserved exactly.
    const fetched = await safeImageFetch(decodedUrl, {
      allowedHosts: isDomainAllowed,
      headers: {
        "User-Agent": "MonkeyTravel/1.0 (PDF Generator)",
        "Accept": "image/*",
      },
    });

    if (!fetched.ok) {
      return fetched.status === 403
        ? errors.forbidden(fetched.reason)
        : errors.serviceUnavailable(`Failed to fetch image: ${fetched.reason}`);
    }
    const response = fetched.response;

    if (!response.ok) {
      return errors.serviceUnavailable(`Failed to fetch image (status: ${response.status})`);
    }

    // Reject a non-image BEFORE spending memory on its body.
    const contentType = imageContentType(response);
    if (!contentType) {
      return errors.badRequest(
        `Not an image: ${response.headers.get("content-type")}`
      );
    }

    // Read with the cap enforced during the read, not after it.
    const buffer = await readCapped(response, MAX_IMAGE_BYTES);
    if (!buffer) {
      return errors.badRequest(`Image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }

    // Convert to base64
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;

    // Cache the result (don't await - fire and forget for speed)
    cacheImage(cacheKey, dataUrl, contentType, decodedUrl);

    return apiSuccess({
      success: true,
      dataUrl,
      contentType,
      size: buffer.length,
      cached: false,
    });
  } catch (error) {
    console.error("[Image Proxy] Error:", error);
    return errors.internal(`Failed to process image: ${String(error)}`, "Image Proxy");
  }
}

/**
 * POST endpoint for batch image fetching with caching
 */
export async function POST(request: NextRequest) {
  // Require authentication to prevent open proxy abuse
  const { errorResponse: authError } = await getAuthenticatedUser();
  if (authError) return authError;

  const { allowed } = await imageProxyLimiter.check(request);
  if (!allowed) return errors.rateLimit("Too many image requests");

  try {
    const body = await request.json();
    const { urls } = body as { urls: string[] };

    if (!urls || !Array.isArray(urls)) {
      return errors.badRequest("Missing urls array");
    }

    // Limit to 20 images per request
    const limitedUrls = urls.slice(0, 20);

    // Fetch all images in parallel (with caching)
    const results = await Promise.allSettled(
      limitedUrls.map(async (imageUrl) => {
        try {
          const url = new URL(imageUrl);

          if (!isDomainAllowed(url.hostname)) {
            return { url: imageUrl, error: "Domain not allowed" };
          }

          // Check cache first
          const cacheKey = getImageCacheKey(imageUrl);
          const cachedImage = await getCachedImage(cacheKey);

          if (cachedImage) {
            return {
              url: imageUrl,
              dataUrl: cachedImage.dataUrl,
              contentType: cachedImage.contentType,
              cached: true,
            };
          }

          // Fetch if not cached. Same per-hop validation as GET — and note
          // this batch path checked isDomainAllowed but NOT the internal
          // address list that GET applies, so routing it through the helper
          // closes that gap as well as the redirect one.
          const fetched = await safeImageFetch(imageUrl, {
            allowedHosts: isDomainAllowed,
            headers: {
              "User-Agent": "MonkeyTravel/1.0 (PDF Generator)",
              "Accept": "image/*",
            },
          });

          if (!fetched.ok) {
            return { url: imageUrl, error: fetched.reason };
          }
          const response = fetched.response;

          if (!response.ok) {
            return { url: imageUrl, error: `HTTP ${response.status}` };
          }

          // Same cap and content-type gate as GET. Doubly worth it on this
          // path: it fans out over a whole itinerary, so an unbounded body
          // here multiplies by the number of images in the batch.
          const contentType = imageContentType(response);
          if (!contentType) {
            return {
              url: imageUrl,
              error: `Not an image: ${response.headers.get("content-type")}`,
            };
          }
          const buffer = await readCapped(response, MAX_IMAGE_BYTES);
          if (!buffer) {
            return {
              url: imageUrl,
              error: `Image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
            };
          }
          const base64 = buffer.toString("base64");
          const dataUrl = `data:${contentType};base64,${base64}`;

          // Cache the result (fire and forget)
          cacheImage(cacheKey, dataUrl, contentType, imageUrl);

          return {
            url: imageUrl,
            dataUrl,
            contentType,
            size: buffer.length,
            cached: false,
          };
        } catch (err) {
          return { url: imageUrl, error: String(err) };
        }
      })
    );

    // Process results
    const images: Record<string, string> = {};
    const fetchErrors: Record<string, string> = {};
    let cacheHits = 0;

    results.forEach((result, index) => {
      const originalUrl = limitedUrls[index];
      if (result.status === "fulfilled" && result.value.dataUrl) {
        images[originalUrl] = result.value.dataUrl;
        if (result.value.cached) cacheHits++;
      } else if (result.status === "fulfilled" && result.value.error) {
        fetchErrors[originalUrl] = result.value.error;
      } else if (result.status === "rejected") {
        fetchErrors[originalUrl] = result.reason?.message || "Unknown error";
      }
    });

    return apiSuccess({
      success: true,
      images,
      errors: fetchErrors,
      fetched: Object.keys(images).length,
      failed: Object.keys(fetchErrors).length,
      cacheHits,
    });
  } catch (error) {
    console.error("[Image Proxy] Batch error:", error);
    return errors.internal(`Failed to process images: ${String(error)}`, "Image Proxy Batch");
  }
}
