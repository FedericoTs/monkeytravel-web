/**
 * Invite Validation Utilities
 *
 * Shared validation logic for trip invites to reduce duplication
 * between GET (preview) and POST (accept) endpoints.
 */

import { errors } from "@/lib/api/response-wrapper";

/**
 * Invite data structure from database
 */
export interface InviteData {
  id: string;
  trip_id: string;
  token: string;
  role: string;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  is_active: boolean;
}

/**
 * Result of invite validation
 */
export interface InviteValidationResult {
  valid: boolean;
  errorResponse?: Response;
  errorCode?: "MAX_USES" | "REVOKED" | "EXPIRED" | "NOT_FOUND";
}

/**
 * Validate an invite is still usable
 *
 * Checks in order:
 * 1. Max uses exceeded (most specific error)
 * 2. Revoked by owner
 * 3. Expired
 *
 * @param invite - Invite data from database
 * @returns Validation result with error response if invalid
 *
 * @example
 * const validation = validateInvite(invite);
 * if (!validation.valid) {
 *   return validation.errorResponse;
 * }
 */
export function validateInvite(invite: InviteData | null): InviteValidationResult {
  if (!invite) {
    return {
      valid: false,
      errorResponse: errors.notFound("Invalid invite link"),
      errorCode: "NOT_FOUND",
    };
  }

  // IMPORTANT: Check max_uses BEFORE is_active to show correct error message
  // (used-up invites may have is_active=false, but "max uses" is more accurate)
  if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) {
    return {
      valid: false,
      errorResponse: errors.gone("This invite link has already been used", "MAX_USES"),
      errorCode: "MAX_USES",
    };
  }

  if (!invite.is_active) {
    return {
      valid: false,
      errorResponse: errors.gone("This invite has been revoked by the trip owner", "REVOKED"),
      errorCode: "REVOKED",
    };
  }

  if (new Date(invite.expires_at) < new Date()) {
    return {
      valid: false,
      errorResponse: errors.gone("This invite has expired", "EXPIRED"),
      errorCode: "EXPIRED",
    };
  }

  return { valid: true };
}

/**
 * Check if an invite is still valid (boolean version for quick checks)
 *
 * @param invite - Invite data from database
 * @returns true if invite is valid and can be used
 */
export function isInviteValid(invite: InviteData | null): boolean {
  return validateInvite(invite).valid;
}

/**
 * Get remaining uses for an invite
 *
 * @param invite - Invite data from database
 * @returns Number of remaining uses, or Infinity if unlimited
 */
export function getRemainingUses(invite: InviteData): number {
  if (invite.max_uses === 0) {
    return Infinity;
  }
  return Math.max(0, invite.max_uses - invite.use_count);
}

/**
 * Calculate time until invite expires
 *
 * @param invite - Invite data from database
 * @returns Milliseconds until expiry, or negative if already expired
 */
export function getTimeUntilExpiry(invite: InviteData): number {
  return new Date(invite.expires_at).getTime() - Date.now();
}
