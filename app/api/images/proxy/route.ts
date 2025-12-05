import { NextRequest, NextResponse } from "next/server";

/**
 * Image proxy API to fetch external images and return as base64
 * This bypasses CORS restrictions for PDF generation
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    // Decode the URL if it was encoded
    const decodedUrl = decodeURIComponent(imageUrl);

    // Validate URL
    const url = new URL(decodedUrl);

    // Only allow certain domains for security
    const allowedDomains = [
      "maps.googleapis.com",
      "lh3.googleusercontent.com",
      "lh5.googleusercontent.com",
      "streetviewpixels-pa.googleapis.com",
      "images.unsplash.com",
      "source.unsplash.com",
      "places.googleapis.com",
      "googleusercontent.com",
    ];

    const isAllowed = allowedDomains.some(domain =>
      url.hostname.includes(domain) || url.hostname.endsWith(domain)
    );

    if (!isAllowed) {
      return NextResponse.json(
        { error: "Domain not allowed", domain: url.hostname },
        { status: 403 }
      );
    }

    // Fetch the image
    const response = await fetch(decodedUrl, {
      headers: {
        "User-Agent": "MonkeyTravel/1.0 (PDF Generator)",
        "Accept": "image/*",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch image", status: response.status },
        { status: response.status }
      );
    }

    // Get the image data as ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine content type
    const contentType = response.headers.get("content-type") || "image/jpeg";

    // Convert to base64
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;

    return NextResponse.json({
      success: true,
      dataUrl,
      contentType,
      size: buffer.length,
    });
  } catch (error) {
    console.error("Image proxy error:", error);
    return NextResponse.json(
      { error: "Failed to process image", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint for batch image fetching
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls } = body as { urls: string[] };

    if (!urls || !Array.isArray(urls)) {
      return NextResponse.json({ error: "Missing urls array" }, { status: 400 });
    }

    // Limit to 20 images per request
    const limitedUrls = urls.slice(0, 20);

    // Fetch all images in parallel
    const results = await Promise.allSettled(
      limitedUrls.map(async (imageUrl) => {
        try {
          const url = new URL(imageUrl);

          // Check allowed domains
          const allowedDomains = [
            "maps.googleapis.com",
            "lh3.googleusercontent.com",
            "lh5.googleusercontent.com",
            "streetviewpixels-pa.googleapis.com",
            "images.unsplash.com",
            "source.unsplash.com",
            "places.googleapis.com",
            "googleusercontent.com",
          ];

          const isAllowed = allowedDomains.some(domain =>
            url.hostname.includes(domain) || url.hostname.endsWith(domain)
          );

          if (!isAllowed) {
            return { url: imageUrl, error: "Domain not allowed" };
          }

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

          return {
            url: imageUrl,
            dataUrl,
            contentType,
            size: buffer.length,
          };
        } catch (err) {
          return { url: imageUrl, error: String(err) };
        }
      })
    );

    // Process results
    const images: Record<string, string> = {};
    const errors: Record<string, string> = {};

    results.forEach((result, index) => {
      const originalUrl = limitedUrls[index];
      if (result.status === "fulfilled" && result.value.dataUrl) {
        images[originalUrl] = result.value.dataUrl;
      } else if (result.status === "fulfilled" && result.value.error) {
        errors[originalUrl] = result.value.error;
      } else if (result.status === "rejected") {
        errors[originalUrl] = result.reason?.message || "Unknown error";
      }
    });

    return NextResponse.json({
      success: true,
      images,
      errors,
      fetched: Object.keys(images).length,
      failed: Object.keys(errors).length,
    });
  } catch (error) {
    console.error("Batch image proxy error:", error);
    return NextResponse.json(
      { error: "Failed to process images", details: String(error) },
      { status: 500 }
    );
  }
}
