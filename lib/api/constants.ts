/**
 * API Constants
 *
 * Centralized constants for API routes to avoid hardcoded arrays
 * scattered across the codebase.
 */

// ============================================
// COLLABORATOR ROLES
// ============================================

/**
 * All valid collaborator roles
 */
export const COLLABORATOR_ROLES = [
  "owner",
  "editor",
  "voter",
  "viewer",
] as const;

export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];

/**
 * Roles that can be assigned when creating invites
 * (excludes "owner" since owner is set on trip creation)
 */
export const ASSIGNABLE_ROLES = ["editor", "voter", "viewer"] as const;

// ============================================
// ACTIVITY STATUSES
// ============================================

/**
 * Valid activity statuses
 */
export const ACTIVITY_STATUSES = [
  "upcoming",
  "in_progress",
  "completed",
  "skipped",
] as const;

export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

// ============================================
// PROPOSAL STATUSES
// ============================================

/**
 * All proposal statuses
 */
export const PROPOSAL_STATUSES = [
  "pending",
  "voting",
  "approved",
  "rejected",
  "withdrawn",
  "expired",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

// ============================================
// TRIP STATUSES
// ============================================

/**
 * Valid trip statuses
 */
export const TRIP_STATUSES = [
  "planning",
  "confirmed",
  "active",
  "completed",
  "cancelled",
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

// ============================================
// VOTE TYPES
// ============================================

/**
 * Proposal vote types
 */
export const PROPOSAL_VOTE_TYPES = ["approve", "reject"] as const;

export type ProposalVoteType = (typeof PROPOSAL_VOTE_TYPES)[number];

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Check if a value is a valid assignable role (for invites)
 */
export function isValidAssignableRole(
  role: unknown
): role is (typeof ASSIGNABLE_ROLES)[number] {
  return (
    typeof role === "string" &&
    ASSIGNABLE_ROLES.includes(role as (typeof ASSIGNABLE_ROLES)[number])
  );
}
