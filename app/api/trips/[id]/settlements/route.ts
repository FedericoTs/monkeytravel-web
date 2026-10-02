/**
 * GET /api/trips/[id]/settlements
 *
 * Returns the greedy minimum-transfer settlement set for a trip — one
 * entry per recommended payment, partitioned by currency.
 *
 * Everyone in the group is settled, guests included, from the same ledger
 * the Today summary adds up (settleUp in lib/expenses/shared), so the two
 * never disagree. Mirrors the existing patterns in /api/trips/[id]/expenses
 * and /api/trips/[id]/activities/from-booking:
 *   - getAuthenticatedUser() → 401 path
 *   - membership probe → 403 / 404 paths
 *   - ledger read → 500 path
 *
 * RESPONSE SHAPE
 *   { transfers: Array<{
 *       fromUser: { id: string; name: string };
 *       toUser: {
 *         id: string;
 *         name: string;
 *         // A guest who joined without signing in: no handles. Guests'
 *         // ids are per-response labels, never their browser cookie.
 *         guest: boolean;
 *         // Optional payment handles — present only when the recipient
 *         // populated them in Settings > Payment Handles. Each is a raw
 *         // app-validated string (PayPal.me handle, Venmo username, Wise
 *         // tag). The client passes these to lib/payments/handle-links
 *         // builders to render "Pay via X" deeplink buttons.
 *         paypal_handle?: string | null;
 *         venmo_handle?:  string | null;
 *         wise_handle?:   string | null;
 *       };
 *       amount:   number;        // 2 DP, from whole cents
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
 *   This used to run through the user-scoped client and lean on
 *   public.users RLS to gate the read. That worked only because the row
 *   policy was USING (true) — i.e. it gated nothing. Since
 *   20260820210000 the policy is id = auth.uid(), so the user-scoped
 *   client returns the CALLER's row and nobody else's: every recipient's
 *   handles would come back empty and the settle-up modal would show its
 *   "no payment handles" empty state, with only a Sentry line to say so.
 *
 *   Authorization for this read is the membership probe below, not RLS.
 *   Once that probe passes, the caller is a member of this trip and the
 *   recipients are exactly the counterparties settled for it —
 *   so the handles are fetched with the service client, scoped to those
 *   ids.
 *
 *   These columns deliberately do NOT live in public_profiles: that view
 *   is readable by anon, and PayPal/Venmo/Wise handles are not public
 *   profile data.
 */

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import { centsToAmount, ledgerNames, settleUp } from "@/lib/expenses/shared";
import { readExpenseLedger } from "@/lib/expenses/snapshot";
import { publicNameOrNull } from "@/lib/profile/public-name";

/** The account id behind a ledger key, or null for a guest. */
const accountOf = (key: string): string | null => (key.startsWith("u:") ? key.slice(2) : null);

export async function GET(_req: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Membership probe first: it is the authorization for the service-role
    // reads below, and unauthorized callers get a clean 403 / 404 rather
    // than an empty list the UI would render as "all settled up".
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

    // A ledger that can't be read in full must not look settled.
    const admin = createAdminClient();
    const { ledger, error } = await readExpenseLedger(admin, tripId);
    if (error) {
      console.error("[settlements GET] ledger read failed", error);
      return errors.internal("Failed to compute settlements", "settlements");
    }
    const owed = settleUp(ledger);

    // Accounts go by their profile name, guests by the name they joined with.
    const names = ledgerNames(ledger);
    const accountIds = Array.from(
      new Set(owed.flatMap((t) => [accountOf(t.fromKey), accountOf(t.toKey)]).filter((id): id is string => id !== null)),
    );
    if (accountIds.length > 0) {
      const { data: profiles, error: profileErr } = await admin.from("public_profiles").select("id, display_name").in("id", accountIds);
      if (profileErr) console.error("[settlements GET] name fetch failed", profileErr);
      for (const p of profiles ?? []) {
        const name = publicNameOrNull(p.display_name as string | null, null);
        if (name) names.set(`u:${p.id as string}`, name);
      }
    }

    // Collect unique recipient account ids so we can fetch their
    // payment handle columns in a single round-trip. We deliberately
    // only fetch handles for RECIPIENTS — the payer doesn't need their
    // own handles to send money, only the receiving side's. This also
    // minimizes the data we surface to the client.
    const recipientIds = Array.from(
      new Set(owed.map((t) => accountOf(t.toKey)).filter((id): id is string => id !== null)),
    );

    // Fetched with the service client — see HANDLE FETCH SCOPING above.
    // The membership probe is the authorization; recipientIds are the
    // counterparties settled for THIS trip, so the read stays
    // scoped to people the caller demonstrably shares a trip with.
    const handlesById = new Map<
      string,
      {
        paypal_handle: string | null;
        venmo_handle: string | null;
        wise_handle: string | null;
      }
    >();
    if (recipientIds.length > 0) {
      const { data: handleRows, error: handleErr } = await admin
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

    // A guest's key is their browser cookie, so guests get a label instead.
    const guestIds = new Map<string, string>();
    const idOf = (key: string): string => {
      const account = accountOf(key);
      if (account) return account;
      if (!guestIds.has(key)) guestIds.set(key, `guest-${guestIds.size + 1}`);
      return guestIds.get(key)!;
    };
    const transfers = owed.map((t) => {
      const recipient = accountOf(t.toKey);
      const handles = recipient ? handlesById.get(recipient) : undefined;
      return {
        fromUser: {
          id: idOf(t.fromKey),
          name: names.get(t.fromKey) ?? "—",
        },
        toUser: {
          id: idOf(t.toKey),
          name: names.get(t.toKey) ?? "—",
          guest: recipient === null,
          paypal_handle: handles?.paypal_handle ?? null,
          venmo_handle: handles?.venmo_handle ?? null,
          wise_handle: handles?.wise_handle ?? null,
        },
        amount: centsToAmount(t.amountCents),
        currency: t.currency,
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
