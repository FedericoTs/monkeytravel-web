/**
 * Trip Status Management
 *
 * Handles automatic status transitions based on dates and manual status changes.
 *
 * Status lifecycle:
 * - planning: Initial state when trip is created
 * - confirmed: User has confirmed the trip details (manual action)
 * - active: Trip is currently happening (automatic based on dates)
 * - completed: Trip has ended (automatic based on dates) - displayed as "Memories"
 * - cancelled: Trip was cancelled (manual action)
 */

import type { TripStatus } from '@/types';

/**
 * Calculate what the trip status should be based on dates
 * This is used for automatic status transitions
 */
export function calculateTripStatus(
  currentStatus: TripStatus,
  startDate: string,
  endDate: string
): TripStatus {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Set times to start/end of day for accurate comparison
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  now.setHours(12, 0, 0, 0); // Noon for comparison

  // Cancelled trips stay cancelled
  if (currentStatus === 'cancelled') {
    return 'cancelled';
  }

  // Trip has ended - mark as completed
  if (now > end) {
    return 'completed';
  }

  // Trip is currently happening - mark as active
  if (now >= start && now <= end) {
    // Only auto-transition from planning/confirmed to active
    if (currentStatus === 'planning' || currentStatus === 'confirmed') {
      return 'active';
    }
    return currentStatus;
  }

  // Trip is in the future - keep current status (planning or confirmed)
  return currentStatus;
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

