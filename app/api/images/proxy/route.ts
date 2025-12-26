import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

// Cache TTL: 30 days (Google Places images are stable)
const IMAGE_CACHE_DAYS = 30;

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
    const { data, error } = await supabase
      .from("google_places_cache")
      .select("*")
      .eq("place_id", `img:${cacheKey}`)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) return null;

    // Update hit count (fire and forget)
    supabase
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
    const expiresAt = new Date(Date.now() + IMAGE_CACHE_DAYS * 24 * 60 * 60 * 1000);

    await supabase.from("google_places_cache").upsert(
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
    hostname.includes(domain) || hostname.endsWith(domain)
  );
}

/**
 * Image proxy API to fetch external images and return as base64
 * This bypasses CORS restrictions for PDF generation
 *
 * CACHING: Uses Supabase cache for 30-day TTL to reduce bandwidth
 */
export async function GET(request: NextRequest) {
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

    // Fetch the image
    const response = await fetch(decodedUrl, {
      headers: {
        "User-Agent": "MonkeyTravel/1.0 (PDF Generator)",
        "Accept": "image/*",
      },
    });

    if (!response.ok) {
      return errors.serviceUnavailable(`Failed to fetch image (status: ${response.status})`);
    }

    // Get the image data as ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine content type
    const contentType = response.headers.get("content-type") || "image/jpeg";

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

          // Fetch if not cached
          const response = await fetch(imageUrl, {
            headers: {
              "User-Agent": "MonkeyTravel/1.0 (PDF Generator)",
              "Accept": "image/*",
            },
          });

          if (!response.ok) {
            return { url: imageUrl, error: `HTTP ${response.status}` };
          }

          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const contentType = response.headers.get("content-type") || "image/jpeg";
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
