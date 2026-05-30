/**
 * /api/trips/[id]/expenses — post-booking spend tracking (task #220).
 *
 * Mirrors the design of /api/trips/[id]/activities/from-booking:
 * owner-or-collaborator membership check, RLS handles the actual
 * read/write authorization, fail-open on logging.
 *
 * GET    → list all expenses on this trip, newest spent_on first
 * POST   → create a new expense (caller becomes created_by)
 * PATCH  → update an existing expense (id in body, creator or owner only)
 * DELETE → remove an expense (id in body, creator or owner only)
 *
 * All endpoints honor RLS — we don't need to re-implement the membership
 * check here for SELECT/INSERT/UPDATE/DELETE because the policies in
 * 20260530_trip_expenses.sql enforce it. The route handler's job is
 * validation, normalization, and response shape.
 */

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";

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
    const { data, error } = await supabase
      .from("trip_expenses")
      .select(
        "id, trip_id, created_by, amount, currency, category, description, spent_on, created_at, updated_at"
      )
      .eq("trip_id", tripId)
      .order("spent_on", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[expenses GET] query failed", error);
      return errors.internal("Failed to load expenses", "expenses");
    }

    void user; // currentUserId is in the response so the UI can render edit/delete affordances
    return apiSuccess({
      expenses: data ?? [],
      currentUserId: user.id,
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

    // RLS WITH CHECK clause requires created_by = auth.uid() AND
    // (owner or collaborator). If user isn't a member, INSERT fails
    // with permission_denied — we surface as 403.
    const { data, error } = await supabase
      .from("trip_expenses")
      .insert({
        trip_id: tripId,
        created_by: user.id,
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
