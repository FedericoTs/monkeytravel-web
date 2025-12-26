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
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

/**
 * Batch fetch user profiles by IDs
 *
 * @param supabase - Supabase client instance
 * @param userIds - Set or array of user IDs to fetch
 * @param fields - Fields to select (default: id, display_name, avatar_url, email)
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
  fields: string = "id, display_name, avatar_url, email"
): Promise<Map<string, UserProfile>> {
  const profileMap = new Map<string, UserProfile>();

  const idsArray = Array.from(userIds).filter(Boolean);
  if (idsArray.length === 0) {
    return profileMap;
  }

  const { data: profiles, error } = await supabase
    .from("users")
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
      email: profile.email ?? null,
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
