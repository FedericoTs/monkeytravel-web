import { NextRequest } from 'next/server';
import { getAuthenticatedUser, verifyTripOwnership } from '@/lib/api/auth';
import { errors, apiSuccess } from '@/lib/api/response-wrapper';
import type { TripRouteContext } from '@/lib/api/route-context';
import type { TripStatus } from '@/types';
import { isValidStatusTransition } from '@/lib/trips/status';
import { readJsonBody } from "@/lib/api/json-body";

/**
 * PATCH /api/trips/[id]/status
 * Update trip status manually (confirm, cancel, etc.)
 *
 * Body:
 * - status: TripStatus (required)
 */
export async function PATCH(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { body, invalidBody } = await readJsonBody(request);
    if (invalidBody) return invalidBody;
    const newStatus = body.status as TripStatus;

    if (!newStatus) {
      return errors.badRequest('Status is required');
    }

    // Validate status value
    const validStatuses: TripStatus[] = ['planning', 'confirmed', 'active', 'completed', 'cancelled'];
    if (!validStatuses.includes(newStatus)) {
      return errors.badRequest('Invalid status value');
    }

    // Fetch current trip with ownership verification
    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id,
      'id, status, start_date, end_date'
    );
    if (tripError) return tripError;

    const currentStatus = trip.status as TripStatus;

    // Validate the transition
    if (!isValidStatusTransition(currentStatus, newStatus)) {
      return errors.badRequest(`Cannot change status from '${currentStatus}' to '${newStatus}'`);
    }

    // Update the status
    const { error: updateError } = await supabase
      .from('trips')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('[Trip Status] Error updating:', updateError);
      return errors.internal('Failed to update status', 'Trip Status');
    }

    return apiSuccess({
      success: true,
      previousStatus: currentStatus,
      newStatus,
    });
  } catch (error) {
    console.error('[Trip Status] Unexpected error in PATCH:', error);
    return errors.internal('Internal server error', 'Trip Status');
  }
}
