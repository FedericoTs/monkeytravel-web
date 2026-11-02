import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { batchFetchUserProfiles } from "@/lib/api/batch-users";
import type { ActivityVote, VoteType } from "@/types";

/**
 * A trip's activity votes, oldest first (one activity's, when given), each
 * with its voter's public name and avatar. Names come from public_profiles,
 * not an embed on users: a trip's voters are other people, and `users` only
 * exposes the caller's own row.
 */
export async function readActivityVotes(
  supabase: SupabaseClient,
  tripId: string,
  activityId?: string
): Promise<{ votes: ActivityVote[]; error: PostgrestError | null }> {
  let query = supabase
    .from("activity_votes")
    .select("id, trip_id, activity_id, user_id, vote_type, comment, vote_weight, voted_at, updated_at")
    .eq("trip_id", tripId);
  if (activityId) query = query.eq("activity_id", activityId);
  const { data, error } = await query.order("voted_at", { ascending: true });
  if (error) return { votes: [], error };

  const rows = data || [];
  const profiles = await batchFetchUserProfiles(
    supabase,
    new Set(rows.map((v) => v.user_id as string))
  );
  const votes = rows.map((v): ActivityVote => {
    const profile = profiles.get(v.user_id as string);
    return {
      id: v.id,
      trip_id: v.trip_id,
      activity_id: v.activity_id,
      user_id: v.user_id,
      vote_type: v.vote_type as VoteType,
      comment: v.comment,
      vote_weight: v.vote_weight,
      voted_at: v.voted_at,
      updated_at: v.updated_at,
      user: profile
        ? {
            display_name: profile.display_name || "Unknown",
            avatar_url: profile.avatar_url || undefined,
          }
        : undefined,
    };
  });
  return { votes, error: null };
}
