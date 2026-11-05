import type { SupabaseClient } from "@supabase/supabase-js";
import { logReadError } from "@/lib/supabase/log-read-error";

// Direct query fallbacks if RPC functions don't exist
export async function fetchUserMetricsDirect(supabase: SupabaseClient) {
  // NOTE: activeLast30Days is ALWAYS 0 on this path, and that is not fixable
  // here. public.users.last_sign_in_at is NULL for every row — the column
  // exists and nothing writes it. The real value lives in auth.users, which
  // PostgREST does not expose, so only get_user_metrics() (SECURITY DEFINER)
  // can read it.
  //
  // This runs only if that RPC errors, so treat a 0 in this field as "the RPC
  // failed", not as a real number.
  const { data: users } = logReadError("admin stats: users", await supabase.from("users").select("id, created_at, last_sign_in_at"));
  const now = new Date();
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    total: users?.length || 0,
    newLast7Days: users?.filter((u) => new Date(u.created_at) > day7Ago).length || 0,
    newLast30Days: users?.filter((u) => new Date(u.created_at) > day30Ago).length || 0,
    activeLast30Days: users?.filter((u) => u.last_sign_in_at && new Date(u.last_sign_in_at) > day30Ago).length || 0,
  };
}

export async function fetchTripMetricsDirect(supabase: SupabaseClient) {
  // `.is("deleted_at", null)` is not decoration. Without it this counted
  // tombstones as trips and overstated the dashboard total. get_trip_metrics()
  // filters the same way, so the RPC path and this fallback cannot disagree.
  const { data: trips } = logReadError("admin stats: trips", await supabase
    .from("trips")
    .select("id, created_at, share_token")
    .is("deleted_at", null));
  const now = new Date();
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    total: trips?.length || 0,
    last7Days: trips?.filter((t) => new Date(t.created_at) > day7Ago).length || 0,
    last30Days: trips?.filter((t) => new Date(t.created_at) > day30Ago).length || 0,
    sharedTrips: trips?.filter((t) => t.share_token).length || 0,
  };
}

export async function fetchAiMetricsDirect(supabase: SupabaseClient) {
  const { data: usage } = logReadError("admin stats: AI usage", await supabase.from("ai_usage").select("id, created_at"));
  const now = new Date();
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    total: usage?.length || 0,
    last7Days: usage?.filter((u) => new Date(u.created_at) > day7Ago).length || 0,
    last30Days: usage?.filter((u) => new Date(u.created_at) > day30Ago).length || 0,
  };
}

export async function fetchSubscriberMetricsDirect(supabase: SupabaseClient) {
  const { data: subs } = logReadError("admin stats: subscribers", await supabase.from("email_subscribers").select("id, subscribed_at, verified, unsubscribed_at"));
  const now = new Date();
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    total: subs?.length || 0,
    last7Days: subs?.filter((s) => new Date(s.subscribed_at) > day7Ago).length || 0,
    last30Days: subs?.filter((s) => new Date(s.subscribed_at) > day30Ago).length || 0,
    verified: subs?.filter((s) => s.verified).length || 0,
    unsubscribed: subs?.filter((s) => s.unsubscribed_at).length || 0,
  };
}
