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

/**
 * Roles that have voting privileges on proposals
 */
export const VOTER_ELIGIBLE_ROLES = ["owner", "editor", "voter"] as const;

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

/**
 * Active proposal statuses (not yet resolved)
 */
export const PROPOSAL_ACTIVE_STATUSES = ["pending", "voting"] as const;

/**
 * Resolved proposal statuses
 */
export const PROPOSAL_RESOLVED_STATUSES = [
  "approved",
  "rejected",
  "withdrawn",
  "expired",
] as const;

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
 * Activity vote types
 */
export const ACTIVITY_VOTE_TYPES = [
  "love",
  "flexible",
  "concerns",
  "no",
] as const;

export type ActivityVoteType = (typeof ACTIVITY_VOTE_TYPES)[number];

/**
 * Proposal vote types
 */
export const PROPOSAL_VOTE_TYPES = ["approve", "reject"] as const;

export type ProposalVoteType = (typeof PROPOSAL_VOTE_TYPES)[number];

// ============================================
// REFERRAL EVENT TYPES
// ============================================

/**
 * Referral tracking event types
 */
export const REFERRAL_EVENT_TYPES = ["signup", "conversion"] as const;

export type ReferralEventType = (typeof REFERRAL_EVENT_TYPES)[number];

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Check if a value is a valid collaborator role
 */
export function isValidRole(role: unknown): role is CollaboratorRole {
  return (
    typeof role === "string" &&
    COLLABORATOR_ROLES.includes(role as CollaboratorRole)
  );
}

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

/**
 * Check if a value is a valid activity status
 */
export function isValidActivityStatus(
  status: unknown
): status is ActivityStatus {
  return (
    typeof status === "string" &&
    ACTIVITY_STATUSES.includes(status as ActivityStatus)
  );
}

/**
 * Check if a value is a valid proposal status
 */
export function isValidProposalStatus(
  status: unknown
): status is ProposalStatus {
  return (
    typeof status === "string" &&
    PROPOSAL_STATUSES.includes(status as ProposalStatus)
  );
}

/**
 * Check if a value is a valid trip status
 */
export function isValidTripStatus(status: unknown): status is TripStatus {
  return (
    typeof status === "string" && TRIP_STATUSES.includes(status as TripStatus)
  );
}
