/**
 * Batch User Profile Fetching Utility
 *
 * Consolidates the repeated pattern of collecting user IDs into a Set,
 * batch fetching profiles, and creating a Map for O(1) lookups.
 *
 * Used across 7+ API routes:
 * - trips/[id]/collaborators
 * - trips/[id]/votes
 * - referral/history
 * - trips/[id]/proposals
 *
 * READS public_profiles, NOT public.users.
 *
 * Every caller here looks up OTHER people — collaborators on a trip, referees
 * in a referral list. That is exactly the access `public.users` is being locked
 * down to prevent, so these reads go through the safe projection instead.
 *
 * `email` was previously in this function's default field list and in the
 * returned shape. It was dead weight with a real cost: /api/trips/[id]/
 * collaborators echoed it into its response, so every trip member's browser
 * received the email address of every other member — while no UI ever read the
 * field and the Collaborator type never declared it. It is gone from both.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * Batch fetch public user profiles by IDs.
 *
 * @param supabase - Supabase client instance
 * @param userIds - Set or array of user IDs to fetch
 * @param fields - Columns to select. MUST exist on public_profiles; anything
 *                 personal (email, preferences, …) is not available by design.
 * @returns Map of user ID to profile data for O(1) lookups
 *
 * @example
 * const userIds = new Set(items.map(i => i.user_id));
 * const profileMap = await batchFetchUserProfiles(supabase, userIds);
 * const profile = profileMap.get(item.user_id);
 */
export async function batchFetchUserProfiles(
  supabase: SupabaseClient,
  userIds: Set<string> | string[],
  fields: string = "id, display_name, avatar_url"
): Promise<Map<string, UserProfile>> {
  const profileMap = new Map<string, UserProfile>();

  const idsArray = Array.from(userIds).filter(Boolean);
  if (idsArray.length === 0) {
    return profileMap;
  }

  const { data: profiles, error } = await supabase
    .from("public_profiles")
    .select(fields)
    .in("id", idsArray);

  if (error) {
    console.error("[batchFetchUserProfiles] Error fetching profiles:", error);
    return profileMap;
  }

  // Type assertion needed due to Supabase's generic return types
  const profileList = (profiles || []) as unknown as UserProfile[];
  for (const profile of profileList) {
    profileMap.set(profile.id, {
      id: profile.id,
      display_name: profile.display_name ?? null,
      avatar_url: profile.avatar_url ?? null,
    });
  }

  return profileMap;
}

/**
 * Get a formatted profile from the map with fallbacks
 */
export function getProfileFromMap(
  profileMap: Map<string, UserProfile>,
  userId: string
): { display_name: string; avatar_url: string | undefined } {
  const profile = profileMap.get(userId);
  return {
    display_name: profile?.display_name || "Unknown User",
    avatar_url: profile?.avatar_url || undefined,
  };
}
