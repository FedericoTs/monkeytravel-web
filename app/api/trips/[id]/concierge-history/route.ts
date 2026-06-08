import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TripRouteContext } from "@/lib/api/route-context";

/**
 * GET /api/trips/[id]/concierge-history
 *
 * Returns the user's past Q&A turns with the F4 Concierge for THIS trip,
 * newest first. Powers the `<ConciergeHistory>` collapsible section on
 * the trip-detail page.
 *
 * Why this exists: the david-cassoni postmortem (2026-06-07) showed that
 * Concierge ran 7 times with no UI trail. The Q&A pairs were paid for
 * but invisible to both the user and us. We now persist via
 * `persistConciergeTurn` in /api/ai/concierge; this route surfaces them.
 *
 * Access control:
 *   - 401 if not authenticated.
 *   - 404 if the user doesn't own the trip (or doesn't have collaborator
 *     access). Enforced by `verifyTripOwnership`, which itself uses RLS
 *     on the trips table — soft-deleted trips return 404 just like
 *     non-existent ones (intentional: deleted trips shouldn't surface
 *     their old chats either).
 *   - Service-role client to READ ai_conversations because the table is
 *     RLS-locked to service_role. The ownership check above is the
 *     real gate; service-role here just bypasses the missing read
 *     policy without weakening the access model.
 */

interface ConciergeTurn {
  id: string;
  question: string;
  answer: string;
  is_live_trip: boolean | null;
  day_number: number | null;
  created_at: string;
}

interface AiConversationRow {
  id: string;
  trip_id: string;
  messages: Array<{ role: string; content: string }>;
  context: { is_live_trip?: boolean; day_number?: number | null } | null;
  created_at: string;
}

export async function GET(_req: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Gate the read behind trip ownership / collaboration. This also
    // implicitly enforces the soft-delete filter (RLS on trips hides
    // tombstoned rows), so a user querying a deleted trip's history
    // gets the same 404 as a non-existent trip — no information leak.
    const { errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      tripId,
      user.id,
      "id"
    );
    if (tripError) return tripError;

    // Read the conversation log via service-role. We project just the
    // shape the UI needs — the `messages` JSONB is two-message turns
    // (user + assistant), so we flatten to {question, answer}.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("ai_conversations")
      .select("id, trip_id, messages, context, created_at")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[concierge-history] read failed", error);
      return errors.internal(
        "Failed to load chat history",
        "concierge-history"
      );
    }

    const rows = (data ?? []) as AiConversationRow[];
    const turns: ConciergeTurn[] = rows.map((row) => {
      const userMsg = row.messages?.find((m) => m.role === "user");
      const assistantMsg = row.messages?.find((m) => m.role === "assistant");
      return {
        id: row.id,
        question: userMsg?.content ?? "",
        answer: assistantMsg?.content ?? "",
        is_live_trip: row.context?.is_live_trip ?? null,
        day_number: row.context?.day_number ?? null,
        created_at: row.created_at,
      };
    });

    return apiSuccess({ turns });
  } catch (err) {
    console.error("[concierge-history] unexpected error", err);
    return errors.internal(
      "Failed to load chat history",
      "concierge-history"
    );
  }
}
