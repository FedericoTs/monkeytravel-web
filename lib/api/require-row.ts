import type { NextResponse } from "next/server";
import { errors } from "./response-wrapper";
import { isNoRow } from "@/lib/supabase/no-row";

type Read = { data: unknown; error: { message: string; code?: string } | null };

/**
 * The row a route can't go on without. No row (or a malformed id) answers 404
 * with `notFound`; a read the database refused answers 500 instead of passing
 * for a missing row.
 *
 *   const { row: proposal, errorResponse: proposalError } = await requireRow(
 *     "proposal",
 *     supabase.from("activity_proposals").select("id").eq("id", proposalId).single(),
 *     "Proposal not found",
 *   );
 *   if (proposalError) return proposalError;
 *
 * It takes the query rather than its awaited result: TypeScript narrows `row`
 * after that check only when the await sits outside the call.
 */
export async function requireRow<R extends Read>(
  label: string,
  query: PromiseLike<R>,
  notFound: string,
): Promise<{ row: NonNullable<R["data"]>; errorResponse: null } | { row: null; errorResponse: NextResponse }> {
  const { data, error } = await query;
  if (error && !isNoRow(error)) {
    console.error(`[${label}] read failed:`, error.message);
    return { row: null, errorResponse: errors.internal(`Failed to load the ${label}`, label) };
  }
  if (!data) return { row: null, errorResponse: errors.notFound(notFound) };
  return { row: data as NonNullable<R["data"]>, errorResponse: null };
}
