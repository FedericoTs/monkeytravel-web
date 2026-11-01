import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { errors } from "@/lib/api/response-wrapper";
import { isNoRow } from "@/lib/supabase/no-row";

/**
 * The live trip behind a share link, with the columns a route needs. A token
 * no live trip carries is a 404; a read the database refused is a 500, so a
 * working link never looks dead.
 *
 *   const { trip, errorResponse } = await readSharedTrip<{ id: string }>(admin, token, "id");
 *   if (errorResponse) return errorResponse;
 */
export async function readSharedTrip<Row extends { id: string }>(
  db: SupabaseClient,
  token: string,
  columns: string,
): Promise<{ trip: Row; errorResponse: null } | { trip: null; errorResponse: NextResponse }> {
  const { data, error } = await db
    .from("trips")
    .select(columns)
    .eq("share_token", token)
    .is("deleted_at", null)
    .maybeSingle();
  if (error && !isNoRow(error)) {
    console.error("[shared trip] read failed:", error.message);
    return { trip: null, errorResponse: errors.internal("Failed to load the shared trip", "Shared trip") };
  }
  if (!data) return { trip: null, errorResponse: errors.notFound("Shared trip not found") };
  return { trip: data as unknown as Row, errorResponse: null };
}
