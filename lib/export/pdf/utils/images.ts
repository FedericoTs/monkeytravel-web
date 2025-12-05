import type { PremiumTripForExport, ImageCache } from "../types";

/**
 * Fetch a single image via our server-side proxy to bypass CORS
 */
export async function fetchImageViaProxy(imageUrl: string): Promise<string | null> {
  if (!imageUrl) return null;

  try {
    const proxyUrl = `/api/images/proxy?url=${encodeURIComponent(imageUrl)}`;
    const response = await fetch(proxyUrl);

    if (!response.ok) {
      console.warn(`Proxy failed for ${imageUrl}:`, response.status);
      return null;
    }

    const data = await response.json();
    if (data.success && data.dataUrl) {
      return data.dataUrl;
    }

    return null;
  } catch (error) {
    console.warn(`Failed to fetch image via proxy: ${imageUrl}`, error);
    return null;
  }
}

/**
 * Batch fetch images via server-side proxy
 */
export async function batchFetchImages(urls: string[]): Promise<Record<string, string>> {
  if (!urls || urls.length === 0) return {};

  try {
    const response = await fetch("/api/images/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });

    if (!response.ok) {
      console.warn("Batch fetch failed:", response.status);
      return {};
    }

    const data = await response.json();
    return data.images || {};
  } catch (error) {
    console.warn("Batch fetch error:", error);
    return {};
  }
}

/**
 * Collect all image URLs from a trip for prefetching
 */
export function collectTripImageUrls(trip: PremiumTripForExport): string[] {
  const urls: string[] = [];

  // Cover image
  if (trip.coverImageUrl) {
    urls.push(trip.coverImageUrl);
  }

  // Gallery photos
  if (trip.galleryPhotos) {
    trip.galleryPhotos.forEach((photo) => {
      if (photo.url) urls.push(photo.url);
      if (photo.thumbnailUrl && photo.thumbnailUrl !== photo.url) {
        urls.push(photo.thumbnailUrl);
      }
    });
  }

  // Activity images
  trip.itinerary.forEach((day) => {
    day.activities.forEach((activity) => {
      if (activity.image_url) {
        urls.push(activity.image_url);
      }
    });
  });

  // Deduplicate
  return [...new Set(urls)];
}

/**
 * Prefetch all trip images with progress callback
 */
export async function prefetchTripImages(
  trip: PremiumTripForExport,
  onProgress?: (step: string, progress: number) => void
): Promise<ImageCache> {
  const imageCache: ImageCache = {};
  const urls = collectTripImageUrls(trip);

  if (urls.length === 0) {
    onProgress?.("No images to load", 100);
    return imageCache;
  }

  onProgress?.(`Loading ${urls.length} images...`, 10);

  // Batch fetch in chunks of 10
  const chunkSize = 10;
  let loaded = 0;

  for (let i = 0; i < urls.length; i += chunkSize) {
    const chunk = urls.slice(i, i + chunkSize);

    try {
      const results = await batchFetchImages(chunk);

      // Add to cache
      Object.entries(results).forEach(([url, dataUrl]) => {
        if (dataUrl) {
          imageCache[url] = dataUrl;
          loaded++;
        }
      });
    } catch (error) {
      console.warn(`Chunk ${i / chunkSize + 1} failed:`, error);
    }

    // Update progress
    const progress = Math.round(10 + (loaded / urls.length) * 80);
    onProgress?.(`Loaded ${loaded}/${urls.length} images`, Math.min(progress, 90));
  }

  onProgress?.(`Images ready (${loaded}/${urls.length})`, 95);
  return imageCache;
}

/**
 * Get image format from base64 data URL
 */
export function getImageFormat(dataUrl: string): "JPEG" | "PNG" | "WEBP" {
  if (!dataUrl) return "JPEG";

  if (dataUrl.includes("image/png")) return "PNG";
  if (dataUrl.includes("image/webp")) return "WEBP";
  return "JPEG";
}

/**
 * Check if an image exists in the cache
 */
export function hasImage(cache: ImageCache, url?: string | null): boolean {
  if (!url) return false;
  return !!cache[url];
}

/**
 * Get image from cache with fallback
 */
export function getImage(cache: ImageCache, url?: string | null): string | null {
  if (!url) return null;
  return cache[url] || null;
}

/**
 * Create a beautiful gradient placeholder for missing images
 * Returns SVG as data URL
 */
export function createGradientPlaceholder(
  width: number,
  height: number,
  type: "cover" | "activity" | "gallery" = "activity",
  activityType?: string
): string {
  // Color schemes based on type
  const schemes: Record<string, { from: string; to: string; accent: string }> = {
    cover: { from: "#667eea", to: "#764ba2", accent: "#f093fb" },
    activity: { from: "#11998e", to: "#38ef7d", accent: "#00d9ff" },
    gallery: { from: "#fc466b", to: "#3f5efb", accent: "#ffd700" },
    // Activity type specific
    eat: { from: "#f093fb", to: "#f5576c", accent: "#ffecd2" },
    see: { from: "#4facfe", to: "#00f2fe", accent: "#43e97b" },
    do: { from: "#fa709a", to: "#fee140", accent: "#ff9a9e" },
    go: { from: "#a8edea", to: "#fed6e3", accent: "#5ee7df" },
    stay: { from: "#667eea", to: "#764ba2", accent: "#f093fb" },
  };

  const scheme = activityType
    ? schemes[activityType.toLowerCase()] || schemes.activity
    : schemes[type];

  // Create SVG with gradient and pattern
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${scheme.from};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${scheme.to};stop-opacity:1" />
        </linearGradient>
        <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="1.5" fill="${scheme.accent}" opacity="0.3"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grad)"/>
      <rect width="${width}" height="${height}" fill="url(#dots)"/>
    </svg>
  `.trim();

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
