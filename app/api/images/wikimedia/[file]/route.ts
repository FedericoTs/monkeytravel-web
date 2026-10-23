import type { NextRequest } from "next/server";
import { DESTINATION_IMAGES_BUCKET } from "@/lib/images/wikimedia";
import { cacheAdminDb } from "@/lib/supabase/cache-admin";

/**
 * Serves a stored Wikimedia photo (lib/images/wikimedia.ts) from the private
 * bucket. The file never changes at this path, so the CDN keeps it: storage is
 * read only on a cache miss. The ".jpg" path also keeps the middleware off it.
 */

const FILE = /^[0-9a-f]{20}-(330|500|960|1280|1920)\.jpg$/;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!FILE.test(file)) return new Response("Not found", { status: 404 });

  const db = cacheAdminDb();
  if (!db) return new Response("Storage unavailable", { status: 503 });

  const { data, error } = await db.storage.from(DESTINATION_IMAGES_BUCKET).download(`wikimedia/${file}`);
  if (error || !data) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  }
  return new Response(data.stream(), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}
