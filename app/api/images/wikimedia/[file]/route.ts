import type { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/api/rate-limit";
import {
  COMMONS_USER_AGENT,
  commonsPhotoId,
  commonsPhotoUrl,
  DESTINATION_IMAGES_BUCKET,
} from "@/lib/images/wikimedia";
import { cacheAdminDb } from "@/lib/supabase/cache-admin";

/**
 * Serves a Wikimedia photo (lib/images/wikimedia.ts). The file never changes at
 * this path, so the CDN keeps it and this runs only on a cache miss. The photo
 * comes from Commons, by the file name in the URL's credit, which has to match
 * the id in the path. A stored copy of an older photo stands in when Commons
 * can't serve it. The ".jpg" path also keeps the middleware off it.
 */

const FILE = /^([0-9a-f]{20})-(330|500|960|1280|1920)\.jpg$/;
const COMMONS_TIMEOUT_MS = 8000;

// A cache miss runs a function and fetches a photo; only scripted hammering gets here.
const limiter = createRateLimiter("wikimedia-photo", 600, 60 * 60 * 1000);

const photo = (body: ReadableStream<Uint8Array>) =>
  new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });

type FromCommons = { body: ReadableStream<Uint8Array> } | { failed: boolean };

async function fromCommons(request: NextRequest, id: string, width: number): Promise<FromCommons> {
  const name = request.nextUrl.searchParams.get("f");
  if (!name || commonsPhotoId(name) !== id) return { failed: false };
  try {
    const res = await fetch(commonsPhotoUrl(name, width), {
      headers: { "User-Agent": COMMONS_USER_AGENT },
      signal: AbortSignal.timeout(COMMONS_TIMEOUT_MS),
    });
    if (res.ok && res.body && res.headers.get("content-type")?.startsWith("image/jpeg")) return { body: res.body };
    return { failed: res.status !== 404 };
  } catch {
    return { failed: true };
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const match = FILE.exec(file);
  if (!match) return new Response("Not found", { status: 404 });

  const { allowed } = await limiter.check(request);
  if (!allowed) return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "no-store" } });

  const commons = await fromCommons(request, match[1], Number(match[2]));
  if ("body" in commons) return photo(commons.body);

  const { data } = (await cacheAdminDb()?.storage.from(DESTINATION_IMAGES_BUCKET).download(`wikimedia/${file}`)) ?? {};
  if (data) return photo(data.stream());

  if (commons.failed) {
    console.error(`[wikimedia-photo] Commons couldn't serve ${file}, and it isn't stored`);
    return new Response("Try again", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
}
