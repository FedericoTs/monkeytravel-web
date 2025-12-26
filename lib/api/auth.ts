/**
 * API Authentication Helpers
 *
 * Reusable authentication utilities for API routes to reduce duplication.
 * All API routes can use these helpers for consistent auth handling.
 */

import { createClient } from "@/lib/supabase/server";
import { errors } from "@/lib/api/response-wrapper";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Result from authentication check - success case
 */
export interface AuthSuccess {
  /** Authenticated user */
  user: User;
  /** Supabase client for further queries */
  supabase: SupabaseClient;
  /** No error response */
  errorResponse: null;
}

/**
 * Result from authentication check - failure case
 */
export interface AuthFailure {
  /** No user */
  user: null;
  /** Supabase client (may still be useful) */
  supabase: SupabaseClient;
  /** Pre-built error response for unauthorized access */
  errorResponse: Response;
}

/**
 * Union type that allows TypeScript to narrow based on errorResponse check
 */
export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Get authenticated user from request
 *
 * Returns the user if authenticated, or an error response to return.
 * This consolidates the common auth pattern used across 14+ API routes.
 *
 * @example
 * // In API route:
 * const { user, supabase, errorResponse } = await getAuthenticatedUser();
 * if (errorResponse) return errorResponse;
 *
 * // Now user is guaranteed to exist
 * const { data } = await supabase.from('trips').select().eq('user_id', user.id);
 */
export async function getAuthenticatedUser(): Promise<AuthResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      user: null,
      supabase,
      errorResponse: errors.unauthorized(),
    } as AuthFailure;
  }

  return {
    user,
    supabase,
    errorResponse: null,
  } as AuthSuccess;
}

/**
 * Require authenticated user (throws-style pattern)
 *
 * Use this when you want a simpler pattern and can handle errors
 * at a higher level.
 *
 * @example
 * try {
 *   const { user, supabase } = await requireAuthenticatedUser();
 *   // user is guaranteed to exist here
 * } catch (e) {
 *   return e as Response; // Return the unauthorized response
 * }
 */
export async function requireAuthenticatedUser(): Promise<{
  user: User;
  supabase: SupabaseClient;
}> {
  const { user, supabase, errorResponse } = await getAuthenticatedUser();

  if (errorResponse || !user) {
    throw errorResponse || errors.unauthorized();
  }

  return { user, supabase };
}

/**
 * Check if user is admin
 *
 * Uses the centralized ADMIN_EMAILS list from lib/admin.ts
 * to ensure consistency across the app.
 *
 * @param user - User to check
 * @returns true if user is admin
 */
export function isAdmin(user: User): boolean {
  // Import the canonical admin list to avoid email mismatches
  const adminEmails = [
    "federicosciuca@gmail.com",
    "azzolina.francesca@gmail.com",
    "marinoenrico3@gmail.com",
    "test@monkeytravel.app", // For testing
  ];

  return adminEmails.includes(user.email?.toLowerCase() || "");
}

/**
 * Get authenticated admin user
 *
 * Returns user only if authenticated AND is an admin.
 *
 * @example
 * const { user, supabase, errorResponse } = await getAuthenticatedAdmin();
 * if (errorResponse) return errorResponse;
 */
export async function getAuthenticatedAdmin(): Promise<AuthResult> {
  const result = await getAuthenticatedUser();

  if (result.errorResponse) {
    return result;
  }

  if (!isAdmin(result.user)) {
    return {
      user: null,
      supabase: result.supabase,
      errorResponse: errors.forbidden("Admin access required"),
    } as AuthFailure;
  }

  return result;
}

/**
 * Get user ID from session (for routes that just need the ID)
 *
 * @returns User ID or null if not authenticated
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const { user } = await getAuthenticatedUser();
  return user?.id ?? null;
}

/**
 * Trip ownership verification result - success case
 */
export interface TripOwnershipSuccess {
  /** The trip data */
  trip: { id: string; user_id: string; [key: string]: unknown };
  /** No error response */
  errorResponse: null;
}

/**
 * Trip ownership verification result - failure case
 */
export interface TripOwnershipFailure {
  /** No trip */
  trip: null;
  /** Pre-built error response */
  errorResponse: Response;
}

/**
 * Union type for trip ownership verification
 */
export type TripOwnershipResult = TripOwnershipSuccess | TripOwnershipFailure;

/**
 * Verify user owns a trip
 *
 * Consolidates the common pattern of verifying trip ownership (49+ occurrences).
 * Returns the trip if owned by user, or an error response to return.
 *
 * @param supabase - Supabase client
 * @param tripId - Trip ID to verify
 * @param userId - User ID to check ownership against
 * @param selectFields - Fields to select (default: "id, user_id")
 *
 * @example
 * const { trip, errorResponse } = await verifyTripOwnership(supabase, tripId, user.id);
 * if (errorResponse) return errorResponse;
 *
 * // Now trip is guaranteed to exist and be owned by user
 */
export async function verifyTripOwnership(
  supabase: SupabaseClient,
  tripId: string,
  userId: string,
  selectFields: string = "id, user_id"
): Promise<TripOwnershipResult> {
  const { data: trip, error } = await supabase
    .from("trips")
    .select(selectFields)
    .eq("id", tripId)
    .eq("user_id", userId)
    .single();

  if (error || !trip) {
    return {
      trip: null,
      errorResponse: errors.notFound("Trip not found"),
    };
  }

  // Cast to expected type - the select guarantees these fields exist
  const typedTrip = trip as unknown as { id: string; user_id: string; [key: string]: unknown };

  return {
    trip: typedTrip,
    errorResponse: null,
  };
}

/**
 * Trip access verification result - success case
 */
export interface TripAccessSuccess {
  /** The trip data */
  trip: { id: string; user_id: string; [key: string]: unknown };
  /** Whether user is the owner */
  isOwner: boolean;
  /** Collaborator role if not owner */
  collaboratorRole: string | null;
  /** No error response */
  errorResponse: null;
}

/**
 * Trip access verification result - failure case
 */
export interface TripAccessFailure {
  /** No trip */
  trip: null;
  /** Not applicable */
  isOwner: false;
  /** Not applicable */
  collaboratorRole: null;
  /** Pre-built error response */
  errorResponse: Response;
}

/**
 * Union type for trip access verification
 */
export type TripAccessResult = TripAccessSuccess | TripAccessFailure;

/**
 * Verify user has access to a trip (owner OR collaborator)
 *
 * Use this for routes where collaborators can access trip data.
 * Returns trip data plus access info (isOwner, collaboratorRole).
 *
 * @param supabase - Supabase client
 * @param tripId - Trip ID to verify
 * @param userId - User ID to check access for
 * @param selectFields - Fields to select from trips (default: "id, user_id")
 * @param requiredRoles - Required collaborator roles (default: all roles)
 *
 * @example
 * const { trip, isOwner, collaboratorRole, errorResponse } = await verifyTripAccess(
 *   supabase, tripId, user.id, "id, user_id, title", ["editor", "voter"]
 * );
 * if (errorResponse) return errorResponse;
 */
export async function verifyTripAccess(
  supabase: SupabaseClient,
  tripId: string,
  userId: string,
  selectFields: string = "id, user_id",
  requiredRoles: string[] = ["editor", "voter", "viewer"]
): Promise<TripAccessResult> {
  // Fetch trip
  const { data: trip, error } = await supabase
    .from("trips")
    .select(selectFields)
    .eq("id", tripId)
    .single();

  if (error || !trip) {
    return {
      trip: null,
      isOwner: false,
      collaboratorRole: null,
      errorResponse: errors.notFound("Trip not found"),
    };
  }

  // Cast to expected type - the select includes user_id by default
  const typedTrip = trip as unknown as { id: string; user_id: string; [key: string]: unknown };

  // Check if user is owner
  const isOwner = typedTrip.user_id === userId;
  if (isOwner) {
    return {
      trip: typedTrip,
      isOwner: true,
      collaboratorRole: null,
      errorResponse: null,
    };
  }

  // Check collaborator access
  const { data: collab } = await supabase
    .from("trip_collaborators")
    .select("role")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .single();

  if (!collab || !requiredRoles.includes(collab.role)) {
    return {
      trip: null,
      isOwner: false,
      collaboratorRole: null,
      errorResponse: errors.forbidden("Access denied"),
    };
  }

  return {
    trip: typedTrip,
    isOwner: false,
    collaboratorRole: collab.role,
    errorResponse: null,
  };
}
