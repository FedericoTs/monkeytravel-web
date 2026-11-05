import { tripDateOnly } from '@/lib/trip/live';
import type { TripStatus } from '@/types';

/**
 * Trip status.
 *
 * The row stores what the owner chose:
 * - planning: Initial state when trip is created
 * - confirmed: The owner confirmed the trip
 * - cancelled: The owner cancelled the trip
 *
 * Whether a trip is under way or over comes from its dates, when it's shown:
 * - active: Trip is happening, displayed as "Ongoing"
 * - completed: Trip has ended, displayed as "Memories"
 */

export type TripTimeline = 'upcoming' | 'current' | 'past';

/**
 * Where a trip stands on `today` (YYYY-MM-DD). Counted in calendar days:
 * `new Date("YYYY-MM-DD")` is midnight UTC, which would end a trip before its
 * last day begins.
 */
export function tripTimeline(startDate: string, endDate: string, today: string): TripTimeline {
  if (tripDateOnly(startDate) > today) return 'upcoming';
  if (tripDateOnly(endDate) < today) return 'past';
  return 'current';
}

/** The status a trip is shown with on `today` (YYYY-MM-DD). */
export function shownTripStatus(status: string, startDate: string, endDate: string, today: string): string {
  if (status === 'cancelled') return status;
  const timeline = tripTimeline(startDate, endDate, today);
  if (timeline === 'past') return 'completed';
  if (timeline === 'current') return 'active';
  return status;
}

/**
 * Check if a status transition is valid
 */
export function isValidStatusTransition(
  fromStatus: TripStatus,
  toStatus: TripStatus
): boolean {
  const validTransitions: Record<TripStatus, TripStatus[]> = {
    planning: ['confirmed', 'cancelled', 'active', 'completed'], // active/completed for auto-transition
    confirmed: ['planning', 'cancelled', 'active', 'completed'], // Can go back to planning
    active: ['completed', 'cancelled'], // Can only complete or cancel during trip
    completed: [], // Completed trips cannot change status
    cancelled: ['planning'], // Can restore a cancelled trip to planning
  };

  return validTransitions[fromStatus]?.includes(toStatus) ?? false;
}

