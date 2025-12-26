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

/**
 * Get display label for trip status
 * "completed" is displayed as "Memories" in the UI
 */
export function getStatusDisplayLabel(status: TripStatus): string {
  const labels: Record<TripStatus, string> = {
    planning: 'Planning',
    confirmed: 'Confirmed',
    active: 'Ongoing',
    completed: 'Memories',
    cancelled: 'Cancelled',
  };
  return labels[status] || status;
}

/**
 * Get the appropriate status color classes for Tailwind
 */
export function getStatusColorClasses(status: TripStatus): string {
  const colors: Record<TripStatus, string> = {
    planning: 'bg-amber-100 text-amber-700',
    confirmed: 'bg-green-100 text-green-700',
    active: 'bg-blue-100 text-blue-700',
    completed: 'bg-purple-100 text-purple-700', // Changed from slate to purple for "Memories"
    cancelled: 'bg-red-100 text-red-700',
  };
  return colors[status] || 'bg-slate-100 text-slate-700';
}

/**
 * Check if user can manually change trip status
 */
export function canChangeStatus(currentStatus: TripStatus): boolean {
  // Completed trips cannot have their status changed
  return currentStatus !== 'completed';
}

/**
 * Get available status options for a trip based on current status and dates
 */
export function getAvailableStatusOptions(
  currentStatus: TripStatus,
  startDate: string,
  endDate: string
): TripStatus[] {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Completed trips have no options
  if (currentStatus === 'completed') {
    return [];
  }

  // Cancelled trips can only be restored to planning
  if (currentStatus === 'cancelled') {
    return ['planning'];
  }

  // Active trips can only be cancelled (completion is automatic)
  if (currentStatus === 'active') {
    return ['cancelled'];
  }

  // For planning/confirmed trips
  const options: TripStatus[] = [];

  if (currentStatus === 'planning') {
    options.push('confirmed');
  } else if (currentStatus === 'confirmed') {
    options.push('planning'); // Allow going back to planning
  }

  options.push('cancelled');

  return options;
}

/**
 * Check if a trip should auto-update its status
 * Returns the new status if an update is needed, null otherwise
 */
export function shouldAutoUpdateStatus(
  currentStatus: TripStatus,
  startDate: string,
  endDate: string
): TripStatus | null {
  const newStatus = calculateTripStatus(currentStatus, startDate, endDate);

  if (newStatus !== currentStatus) {
    return newStatus;
  }

  return null;
}
