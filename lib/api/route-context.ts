/**
 * Shared Route Context Types for Next.js API Routes
 *
 * Centralizes RouteContext interfaces to eliminate duplication across 19+ API routes.
 * All route param patterns are defined here with proper TypeScript typing.
 *
 * @example
 * // Instead of defining inline:
 * // interface RouteContext { params: Promise<{ id: string }> }
 *
 * // Import from here:
 * import { TripRouteContext } from "@/lib/api/route-context";
 *
 * export async function GET(request: NextRequest, context: TripRouteContext) {
 *   const { id } = await context.params;
 *   // ...
 * }
 */

/**
 * Generic route context wrapper for any params shape
 */
export type RouteContext<T extends Record<string, string>> = {
  params: Promise<T>;
};

// ============================================================================
// TRIP ROUTES
// ============================================================================

/**
 * Routes: /api/trips/[id]/*
 * Used by: trips/[id]/route.ts, activities/route.ts, archive, checklist, etc.
 */
export type TripRouteContext = RouteContext<{ id: string }>;

/**
 * Routes: /api/trips/[id]/activities/[activityId]/*
 * Used by: activities/[activityId]/route.ts, vote/route.ts
 */
export type TripActivityRouteContext = RouteContext<{ id: string; activityId: string }>;

/**
 * Routes: /api/trips/[id]/checklist/[itemId]
 */
export type TripChecklistItemRouteContext = RouteContext<{ id: string; itemId: string }>;

/**
 * Routes: /api/trips/[id]/collaborators/[userId]
 */
export type TripCollaboratorRouteContext = RouteContext<{ id: string; userId: string }>;

/**
 * Routes: /api/trips/[id]/invites/[inviteId]
 */
export type TripInviteRouteContext = RouteContext<{ id: string; inviteId: string }>;

/**
 * Routes: /api/trips/[id]/proposals/[proposalId]/*
 * Used by: proposals/[proposalId]/route.ts, vote/route.ts
 */
export type TripProposalRouteContext = RouteContext<{ id: string; proposalId: string }>;

// ============================================================================
// INVITE ROUTES
// ============================================================================

/**
 * Routes: /api/invites/[token]
 */
export type InviteTokenRouteContext = RouteContext<{ token: string }>;

// ============================================================================
// TEMPLATE ROUTES
// ============================================================================

/**
 * Routes: /api/templates/[id]/*
 */
export type TemplateRouteContext = RouteContext<{ id: string }>;

// ============================================================================
// REFERRAL ROUTES (for future use)
// ============================================================================

/**
 * Routes: /api/referral/[code]
 */
export type ReferralCodeRouteContext = RouteContext<{ code: string }>;

// ============================================================================
// HELPER TYPE GUARDS
// ============================================================================

/**
 * Extract params type from a RouteContext
 * @example
 * type TripParams = ExtractParams<TripRouteContext>;
 * // Result: { id: string }
 */
export type ExtractParams<T> = T extends RouteContext<infer P> ? P : never;
