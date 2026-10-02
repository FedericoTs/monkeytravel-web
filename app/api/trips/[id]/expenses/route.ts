/**
 * /api/trips/[id]/expenses — post-booking spend tracking (task #220).
 *
 * Mirrors the design of /api/trips/[id]/activities/from-booking:
 * owner-or-collaborator membership check, RLS handles the actual
 * read/write authorization, fail-open on logging.
 *
 * GET    → list all expenses on this trip, newest spent_on first
 * POST   → create a new expense (caller becomes created_by and payer,
 *          split equally across the trip's group, lib/trips/roster)
 * PATCH  → update an existing expense (id in body, creator or owner only)
 * DELETE → remove an expense (id in body, creator or owner only)
 *
 * All endpoints honor RLS — we don't need to re-implement the membership
 * check here for SELECT/INSERT/UPDATE/DELETE because the policies in
 * 20260530_trip_expenses.sql enforce it. The route handler's job is
 * validation, normalization, and response shape.
 */

import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import { centsToAmount, splitEquallyCents } from "@/lib/expenses/shared";
import { publicNameOrNull } from "@/lib/profile/public-name";
import { createAdminClient } from "@/lib/supabase/admin";
import { expenseCohort, tripRoster } from "@/lib/trips/roster";

/**
 * Equal shares across the trip's group (lib/trips/roster), the payer
 * included once. Settle Up adds up payers and shares, so without them a
 * member's expense never reached it. Returns the error that stopped it, if
 * any.
 */
async function insertMemberSplits(supabase: SupabaseClient, tripId: string, expenseId: string, amount: number, payerId: string | null) {
  const { data: trip, error: tripError } = await supabase.from("trips").select("user_id").eq("id", tripId).maybeSingle();
  // The "I'm going" list is readable by the service role only.
  const { roster, error: rosterError } = tripError
    ? { roster: [], error: tripError }
    : await tripRoster(createAdminClient(), { id: tripId, user_id: (trip?.user_id as string | null) ?? null });
  if (rosterError) {
    console.error("[expenses] member lookup failed", rosterError);
    return rosterError;
  }
  const members = expenseCohort(roster, payerId ? { userId: payerId, cookieId: null, name: null } : null);
  const shares = splitEquallyCents(Math.round(amount * 100), members.length);
  const { error } = await supabase.from("trip_expense_splits").insert(
    members.map((m, i) => ({
      expense_id: expenseId,
      user_id: m.userId,
      participant_cookie_id: m.userId ? null : m.cookieId,
      participant_name: m.name,
      share_amount: centsToAmount(shares[i]),
    })),
  );
  if (error) console.error("[expenses] split insert failed", error);
  return error;
}

/** A new amount re-divides the existing shares: same people, settled flags kept. */
async function resplit(supabase: SupabaseClient, tripId: string, expenseId: string, amount: number) {
  const { data: existing, error: readError } = await supabase
    .from("trip_expense_splits")
    .select("id, user_id, participant_cookie_id")
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (readError) {
    console.error("[expenses] split read failed", readError);
    return readError;
  }
  if (!existing || existing.length === 0) {
    const { data: expense } = await supabase.from("trip_expenses").select("paid_by_user_id").eq("id", expenseId).maybeSingle();
    return insertMemberSplits(supabase, tripId, expenseId, amount, (expense?.paid_by_user_id as string | null) ?? null);
  }
  const shares = splitEquallyCents(Math.round(amount * 100), existing.length);
  // One statement, so the shares change together or not at all. Each row
  // keeps its identity: the identity check runs on the proposed row before
  // the conflict turns the insert into an update.
  const { error } = await supabase.from("trip_expense_splits").upsert(
    existing.map((s, i) => ({
      id: s.id,
      expense_id: expenseId,
      user_id: s.user_id,
      participant_cookie_id: s.participant_cookie_id,
      share_amount: centsToAmount(shares[i]),
    })),
    { onConflict: "id" },
  );
  if (error) console.error("[expenses] split update failed", error);
  return error;
}

const VALID_CATEGORIES = [
  "transport",
  "accommodation",
  "food",
  "activity",
  "shopping",
  "other",
] as const;
type ExpenseCategory = (typeof VALID_CATEGORIES)[number];

const DESCRIPTION_MAX = 280;
const AMOUNT_MAX = 9_999_999_999.99; // matches NUMERIC(12,2)

/**
 * Loose runtime guard for currency code. We don't enforce a hard list
 * here — that would mean a schema change every time a user travels
 * somewhere new. Three uppercase letters is the ISO 4217 shape.
 */
function isValidCurrency(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length === 3 &&
    /^[A-Z]{3}$/.test(s)
  );
}

function normalizeBody(body: unknown): {
  amount?: number;
  currency?: string;
  category?: ExpenseCategory;
  description?: string | null;
  spent_on?: string;
} {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const out: ReturnType<typeof normalizeBody> = {};

  if (typeof b.amount === "number" && Number.isFinite(b.amount)) {
    out.amount = Math.round(b.amount * 100) / 100;
  } else if (typeof b.amount === "string") {
    const n = Number(b.amount);
    if (Number.isFinite(n)) out.amount = Math.round(n * 100) / 100;
  }

  if (typeof b.currency === "string") {
    out.currency = b.currency.trim().toUpperCase();
  }

  if (typeof b.category === "string") {
    const c = b.category.trim().toLowerCase();
    if ((VALID_CATEGORIES as readonly string[]).includes(c)) {
      out.category = c as ExpenseCategory;
    }
  }

  if (b.description === null) {
    out.description = null;
  } else if (typeof b.description === "string") {
    out.description = b.description.trim().slice(0, DESCRIPTION_MAX) || null;
  }

  if (typeof b.spent_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.spent_on)) {
    out.spent_on = b.spent_on;
  }

  return out;
}

export async function GET(_req: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // RLS handles the membership filter; this query is fine without an
    // explicit join. If the user can't see this trip, they get zero rows.
    // We also probe trips.user_id so the client knows whether the caller
    // is the trip owner — RLS allows owner OR creator to DELETE/UPDATE,
    // but the UI previously only knew about the creator branch (hid the
    // trash icon on collaborator-authored rows even when the owner could
    // legitimately delete them).
    const [{ data, error }, { data: tripRow, error: tripErr }] =
      await Promise.all([
        supabase
          .from("trip_expenses")
          .select(
            "id, trip_id, created_by, amount, currency, category, description, spent_on, created_at, updated_at"
          )
          .eq("trip_id", tripId)
          .order("spent_on", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("trips")
          .select("user_id")
          .eq("id", tripId)
          .maybeSingle(),
      ]);

    if (error) {
      console.error("[expenses GET] query failed", error);
      return errors.internal("Failed to load expenses", "expenses");
    }
    if (tripErr) {
      // Non-fatal: ledger still works, owner just won't see extra delete
      // affordances on collaborator rows. Log so we notice if it spikes.
      console.warn("[expenses GET] trip owner probe failed", tripErr);
    }

    const isTripOwner = tripRow?.user_id === user.id;

    return apiSuccess({
      expenses: data ?? [],
      currentUserId: user.id,
      isTripOwner,
    });
  } catch (err) {
    console.error("[expenses GET] unexpected", err);
    return errors.internal("Failed to load expenses", "expenses");
  }
}

export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest("Invalid JSON body");
    }
    const parsed = normalizeBody(body);

    if (typeof parsed.amount !== "number" || parsed.amount < 0) {
      return errors.badRequest("amount is required (>= 0)");
    }
    if (parsed.amount > AMOUNT_MAX) {
      return errors.badRequest(`amount exceeds maximum (${AMOUNT_MAX})`);
    }
    if (!parsed.currency || !isValidCurrency(parsed.currency)) {
      return errors.badRequest("currency must be a 3-letter ISO code");
    }
    if (!parsed.category) {
      return errors.badRequest(
        `category must be one of: ${VALID_CATEGORIES.join(", ")}`
      );
    }

    // The shared ledger shows the payer's name to anyone with the link.
    const { data: profile } = await supabase.from("users").select("display_name").eq("id", user.id).maybeSingle();
    const payerName = publicNameOrNull(profile?.display_name as string | null | undefined, user.email);

    // RLS WITH CHECK clause requires created_by = auth.uid() AND
    // (owner or collaborator). If user isn't a member, INSERT fails
    // with permission_denied — we surface as 403.
    const { data, error } = await supabase
      .from("trip_expenses")
      .insert({
        trip_id: tripId,
        created_by: user.id,
        created_by_name: payerName,
        paid_by_user_id: user.id,
        paid_by_name: payerName,
        amount: parsed.amount,
        currency: parsed.currency,
        category: parsed.category,
        description: parsed.description ?? null,
        spent_on: parsed.spent_on, // omit if undefined → DB default to CURRENT_DATE
      })
      .select(
        "id, trip_id, created_by, amount, currency, category, description, spent_on, created_at, updated_at"
      )
      .single();

    if (error) {
      // RLS / membership rejection looks like a permission_denied (42501).
      if (error.code === "42501") {
        return errors.forbidden("You must be a member of this trip");
      }
      console.error("[expenses POST] insert failed", error);
      return errors.internal("Failed to create expense", "expenses");
    }

    const splitError = await insertMemberSplits(supabase, tripId, data.id, parsed.amount, user.id);
    if (splitError) {
      // Without shares the expense never reaches Settle Up: don't keep half of it.
      const { error: undoError } = await supabase.from("trip_expenses").delete().eq("id", data.id);
      if (undoError) console.error("[expenses POST] undo failed", undoError);
      return errors.internal("Failed to create expense", "expenses");
    }
    return apiSuccess({ expense: data });
  } catch (err) {
    console.error("[expenses POST] unexpected", err);
    return errors.internal("Failed to create expense", "expenses");
  }
}

export async function PATCH(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest("Invalid JSON body");
    }
    const raw = body as { id?: unknown } | null;
    const expenseId =
      raw && typeof raw.id === "string" ? raw.id : null;
    if (!expenseId) {
      return errors.badRequest("id is required");
    }

    const parsed = normalizeBody(body);
    const update: Record<string, unknown> = {};
    if (parsed.amount !== undefined) {
      if (parsed.amount < 0 || parsed.amount > AMOUNT_MAX) {
        return errors.badRequest(`amount must be 0..${AMOUNT_MAX}`);
      }
      update.amount = parsed.amount;
    }
    if (parsed.currency !== undefined) {
      if (!isValidCurrency(parsed.currency)) {
        return errors.badRequest("currency must be a 3-letter ISO code");
      }
      update.currency = parsed.currency;
    }
    if (parsed.category !== undefined) update.category = parsed.category;
    if (parsed.description !== undefined) update.description = parsed.description;
    if (parsed.spent_on !== undefined) update.spent_on = parsed.spent_on;

    if (Object.keys(update).length === 0) {
      return errors.badRequest("no editable fields supplied");
    }

    // The shares follow the amount. If they can't, the edit is undone.
    let before: Record<string, unknown> | null = null;
    if (typeof update.amount === "number") {
      const { data: previous } = await supabase
        .from("trip_expenses")
        .select("amount, currency, category, description, spent_on")
        .eq("id", expenseId)
        .eq("trip_id", tripId)
        .maybeSingle();
      before = previous;
    }

    const { data, error } = await supabase
      .from("trip_expenses")
      .update(update)
      .eq("id", expenseId)
      .eq("trip_id", tripId)
      .select(
        "id, trip_id, created_by, amount, currency, category, description, spent_on, created_at, updated_at"
      )
      .maybeSingle();

    if (error) {
      if (error.code === "42501") {
        return errors.forbidden("You can only edit your own expenses");
      }
      console.error("[expenses PATCH] update failed", error);
      return errors.internal("Failed to update expense", "expenses");
    }
    if (!data) {
      // RLS hid the row (not creator and not owner) OR id mismatch.
      return errors.notFound("Expense not found");
    }

    if (typeof update.amount === "number" && (await resplit(supabase, tripId, expenseId, update.amount))) {
      if (before) {
        const restore = Object.fromEntries(Object.keys(update).map((k) => [k, before[k]]));
        const { error: undoError } = await supabase
          .from("trip_expenses")
          .update(restore)
          .eq("id", expenseId)
          .eq("trip_id", tripId);
        if (undoError) console.error("[expenses PATCH] undo failed", undoError);
      }
      return errors.internal("Failed to update expense", "expenses");
    }
    void user;
    return apiSuccess({ expense: data });
  } catch (err) {
    console.error("[expenses PATCH] unexpected", err);
    return errors.internal("Failed to update expense", "expenses");
  }
}

export async function DELETE(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest("Invalid JSON body");
    }
    const raw = body as { id?: unknown } | null;
    const expenseId =
      raw && typeof raw.id === "string" ? raw.id : null;
    if (!expenseId) {
      return errors.badRequest("id is required");
    }

    const { error, count } = await supabase
      .from("trip_expenses")
      .delete({ count: "exact" })
      .eq("id", expenseId)
      .eq("trip_id", tripId);

    if (error) {
      if (error.code === "42501") {
        return errors.forbidden("You can only delete your own expenses");
      }
      console.error("[expenses DELETE] failed", error);
      return errors.internal("Failed to delete expense", "expenses");
    }
    if (!count) {
      return errors.notFound("Expense not found");
    }

    void user;
    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error("[expenses DELETE] unexpected", err);
    return errors.internal("Failed to delete expense", "expenses");
  }
}
