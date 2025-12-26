import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { errors, apiSuccess } from '@/lib/api/response-wrapper';
import type { TripRouteContext } from '@/lib/api/route-context';

/**
 * POST /api/trips/[id]/archive
 * Archive a trip (soft delete - keeps the trip but hides it from main view)
 *
 * IMPORTANT: Archiving does NOT refund usage limits.
 * The trip creation was already counted, archiving just hides it.
 */
export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Fetch trip to verify ownership
    const { data: trip, error: fetchError } = await supabase
      .from('trips')
      .select('id, is_archived')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !trip) {
      return errors.notFound('Trip not found');
    }

    if (trip.is_archived) {
      return errors.badRequest('Trip is already archived');
    }

    // Archive the trip
    const { error: updateError } = await supabase
      .from('trips')
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('[Archive] Error archiving trip:', updateError);
      return errors.internal('Failed to archive trip', 'Archive');
    }

    return apiSuccess({
      success: true,
      message: 'Trip archived successfully',
    });
  } catch (error) {
    console.error('[Archive] Unexpected error in POST:', error);
    return errors.internal('Internal server error', 'Archive');
  }
}

/**
 * DELETE /api/trips/[id]/archive
 * Unarchive a trip (restore it to the main view)
 */
export async function DELETE(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Fetch trip to verify ownership
    const { data: trip, error: fetchError } = await supabase
      .from('trips')
      .select('id, is_archived')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !trip) {
      return errors.notFound('Trip not found');
    }

    if (!trip.is_archived) {
      return errors.badRequest('Trip is not archived');
    }

    // Unarchive the trip
    const { error: updateError } = await supabase
      .from('trips')
      .update({
        is_archived: false,
        archived_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('[Archive] Error unarchiving trip:', updateError);
      return errors.internal('Failed to unarchive trip', 'Archive');
    }

    return apiSuccess({
      success: true,
      message: 'Trip restored successfully',
    });
  } catch (error) {
    console.error('[Archive] Unexpected error in DELETE:', error);
    return errors.internal('Internal server error', 'Archive');
  }
}
