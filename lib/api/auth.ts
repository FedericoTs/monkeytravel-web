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
 * @param user - User to check
 * @returns true if user is admin
 */
export function isAdmin(user: User): boolean {
  const adminEmails = [
    "federico.sciuca@gmail.com",
    "test@monkeytravel.app",
  ];

  return adminEmails.includes(user.email || "");
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
