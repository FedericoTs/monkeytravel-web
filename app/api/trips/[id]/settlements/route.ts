/**
 * GET /api/trips/[id]/settlements
 *
 * Returns the greedy minimum-transfer settlement set for a trip — one
 * entry per recommended payment, partitioned by currency.
 *
 * The actual computation runs in Postgres (compute_trip_settlements
 * RPC, see 20260531_day10_expense_splits.sql) so all the membership
 * gating lives in RLS — the route handler is a thin verify-then-call
 * wrapper. Mirrors the existing patterns in /api/trips/[id]/expenses
 * and /api/trips/[id]/activities/from-booking:
 *   - getAuthenticatedUser() → 401 path
 *   - membership probe → 403 / 404 paths
 *   - RPC call → 500 path
 *
 * RESPONSE SHAPE
 *   { transfers: Array<{
 *       fromUser: { id: string; name: string };
 *       toUser: {
 *         id: string;
 *         name: string;
 *         // Optional payment handles — present only when the recipient
 *         // populated them in Settings > Payment Handles. Each is a raw
 *         // app-validated string (PayPal.me handle, Venmo username, Wise
 *         // tag). The client passes these to lib/payments/handle-links
 *         // builders to render "Pay via X" deeplink buttons.
 *         paypal_handle?: string | null;
 *         venmo_handle?:  string | null;
 *         wise_handle?:   string | null;
 *       };
 *       amount:   number;        // ALREADY ROUNDED TO 2 DP by the RPC
 *       currency: string;        // 3-letter ISO code, uppercased
 *     }>,
 *     // Trip title used by the client as the deeplink "note" so the
 *     // recipient sees e.g. "Paris weekend" attached to the inbound
 *     // payment. Optional — falls back to the trip id if unset.
 *     tripName?: string | null
 *   }
 *
 * Empty transfers array means "all settled up" — the UI renders the
 * success state.
 *
 * HANDLE FETCH SCOPING
 *   The recipient handle JOIN runs through the user-scoped supabase
 *   client (NOT service_role), so public.users RLS gates exactly which
 *   rows the requesting user can see. That's the same client pattern
 *   batchFetchUserProfiles uses across /api/trips/[id]/collaborators
 *   and /api/trips/[id]/votes — the existing public.users RLS already
 *   allows trip members to read each other's profile columns (see
 *   migration 20260531_day10_user_payment_handles.sql comments).
 */

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";

interface SettlementRow {
  from_user_id: string;
  from_name: string | null;
  to_user_id: string;
  to_name: string | null;
  amount: number | string; // PG NUMERIC → string in some driver versions
  currency: string;
}

export async function GET(_req: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Membership probe before the RPC. The RPC itself is SECURITY INVOKER
    // and RLS-gated, so a non-member call returns an empty array rather
    // than 403 — which the UI would render as "all settled up", giving
    // the wrong signal. We probe trips + trip_collaborators here so
    // unauthorized callers get a clean 403 / 404 instead.
    const [tripProbe, collabProbe] = await Promise.all([
      // `title` rides along here so we can pass it as the deeplink
      // "note" / "description" without a second round-trip — the payer
      // sees "Paris weekend" attached to the inbound transfer when they
      // hit the provider app.
      supabase
        .from("trips")
        .select("id, user_id, title")
        .eq("id", tripId)
        .maybeSingle(),
      supabase
        .from("trip_collaborators")
        .select("user_id")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    if (tripProbe.error) {
      console.error("[settlements GET] trip probe failed", tripProbe.error);
      return errors.internal("Failed to load settlements", "settlements");
    }
    if (!tripProbe.data) {
      // Trip doesn't exist OR RLS hid it — either way, 404 is correct.
      return errors.notFound("Trip not found");
    }

    const isOwner = tripProbe.data.user_id === user.id;
    const isCollaborator = Boolean(collabProbe.data);
    if (!isOwner && !isCollaborator) {
      return errors.forbidden("You must be a member of this trip");
    }

    // Trust the RPC to compute + round. Pass tripId via positional arg
    // — the supabase-js .rpc() call passes a single JSON object so we
    // name the parameter to match the SQL signature (p_trip_id).
    const { data, error } = await supabase.rpc("compute_trip_settlements", {
      p_trip_id: tripId,
    });

    if (error) {
      console.error("[settlements GET] rpc failed", error);
      return errors.internal("Failed to compute settlements", "settlements");
    }

    const rows = (data as SettlementRow[] | null) ?? [];

    // Collect unique recipient (to_user_id) ids so we can fetch their
    // payment handle columns in a single round-trip. We deliberately
    // only fetch handles for RECIPIENTS — the payer doesn't need their
    // own handles to send money, only the receiving side's. This also
    // minimizes the data we surface to the client.
    const recipientIds = Array.from(
      new Set(rows.map((r) => r.to_user_id).filter(Boolean)),
    );

    // Fetch handles via the user-scoped supabase client so public.users
    // RLS gates the read. The same row shape is already exposed to trip
    // members by /api/trips/[id]/collaborators via batchFetchUserProfiles
    // — adding three more profile columns is the same trust boundary,
    // not a wider one. A non-member who somehow reached this code path
    // would already have been bounced by the membership probe above; a
    // legit member only sees rows for users they share a trip with,
    // which is precisely the recipients in this RPC result.
    const handlesById = new Map<
      string,
      {
        paypal_handle: string | null;
        venmo_handle: string | null;
        wise_handle: string | null;
      }
    >();
    if (recipientIds.length > 0) {
      const { data: handleRows, error: handleErr } = await supabase
        .from("users")
        .select("id, paypal_handle, venmo_handle, wise_handle")
        .in("id", recipientIds);

      if (handleErr) {
        // Don't fail the whole settlements endpoint on a handle-fetch
        // miss — degrade gracefully to "no handles", which makes the
        // PaymentLinkButtons surface its empty-state hint. We log so the
        // miss is visible in Sentry but the settle-up modal still opens.
        console.error("[settlements GET] handle fetch failed", handleErr);
      } else {
        for (const row of (handleRows ?? []) as Array<{
          id: string;
          paypal_handle: string | null;
          venmo_handle: string | null;
          wise_handle: string | null;
        }>) {
          handlesById.set(row.id, {
            paypal_handle: row.paypal_handle,
            venmo_handle: row.venmo_handle,
            wise_handle: row.wise_handle,
          });
        }
      }
    }

    // Normalize: NUMERIC arrives as string in some node-postgres versions
    // but as number when supabase-js auto-parses. Force-to-number once
    // here so the wire format is stable for the UI.
    const transfers = rows.map((r) => {
      const amt = typeof r.amount === "string" ? Number(r.amount) : r.amount;
      const handles = handlesById.get(r.to_user_id);
      return {
        fromUser: {
          id: r.from_user_id,
          name: (r.from_name ?? "").trim() || "—",
        },
        toUser: {
          id: r.to_user_id,
          name: (r.to_name ?? "").trim() || "—",
          paypal_handle: handles?.paypal_handle ?? null,
          venmo_handle: handles?.venmo_handle ?? null,
          wise_handle: handles?.wise_handle ?? null,
        },
        amount: Number.isFinite(amt) ? amt : 0,
        currency: r.currency,
      };
    });

    return apiSuccess({
      transfers,
      tripName: tripProbe.data.title ?? null,
    });
  } catch (err) {
    console.error("[settlements GET] unexpected", err);
    return errors.internal("Failed to load settlements", "settlements");
  }
}
