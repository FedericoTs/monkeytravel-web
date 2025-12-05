import type { ImageCache } from "../types";

/**
 * Fetch an image from URL and convert to base64 for PDF embedding
 */
export async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "image/*",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Failed to fetch image: ${url} - ${response.status}`);
      return null;
    }

    const blob = await response.blob();

    // Verify it's an image
    if (!blob.type.startsWith("image/")) {
      console.warn(`Not an image: ${url} - ${blob.type}`);
      return null;
    }

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = () => {
        console.warn(`Failed to read image: ${url}`);
        resolve(null);
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`Image fetch timeout: ${url}`);
    } else {
      console.warn(`Image fetch error: ${url}`, error);
    }
    return null;
  }
}

/**
 * Pre-fetch all images for a trip
 * Uses batching to prevent overwhelming the network
 */
export async function prefetchTripImages(
  coverUrl?: string,
  activities?: Array<{ image_url?: string }>,
  galleryPhotos?: Array<{ url: string; thumbnailUrl: string }>
): Promise<ImageCache> {
  const cache: ImageCache = {};
  const urls: string[] = [];

  // Collect unique URLs
  if (coverUrl) urls.push(coverUrl);

  activities?.forEach((activity) => {
    if (activity.image_url && !urls.includes(activity.image_url)) {
      urls.push(activity.image_url);
    }
  });

  galleryPhotos?.forEach((photo) => {
    if (photo.url && !urls.includes(photo.url)) {
      urls.push(photo.url);
    }
    if (photo.thumbnailUrl && !urls.includes(photo.thumbnailUrl)) {
      urls.push(photo.thumbnailUrl);
    }
  });

  // Fetch in batches to prevent rate limiting
  const BATCH_SIZE = 5;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (url) => {
        const base64 = await fetchImageAsBase64(url);
        return { url, base64 };
      })
    );

    results.forEach(({ url, base64 }) => {
      if (base64) {
        cache[url] = base64;
      }
    });

    // Small delay between batches
    if (i + BATCH_SIZE < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return cache;
}

/**
 * Get image format from base64 string
 */
export function getImageFormat(base64: string): "JPEG" | "PNG" | "GIF" | "WEBP" {
  if (base64.includes("data:image/png")) return "PNG";
  if (base64.includes("data:image/gif")) return "GIF";
  if (base64.includes("data:image/webp")) return "WEBP";
  return "JPEG"; // Default to JPEG
}

/**
 * Check if a cached image exists
 */
export function hasImage(cache: ImageCache, url?: string): boolean {
  return !!url && !!cache[url];
}
