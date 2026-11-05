import type { SupabaseClient } from "@supabase/supabase-js";
import { logReadError } from "@/lib/supabase/log-read-error";
import type { AdminStats } from "./types";

export async function fetchRecentActivity(supabase: SupabaseClient) {
  const activities: AdminStats["recentActivity"] = [];

  // Recent users
  const { data: recentUsers } = logReadError("admin stats: recent users", await supabase
    .from("users")
    .select("email, created_at")
    .order("created_at", { ascending: false })
    .limit(5));

  recentUsers?.forEach((u) => {
    activities.push({
      type: "user",
      description: `New user: ${u.email}`,
      timestamp: u.created_at,
    });
  });

  // Recent trips
  const { data: recentTrips } = logReadError("admin stats: recent trips", await supabase
    .from("trips")
    .select("title, created_at")
    .order("created_at", { ascending: false })
    .limit(5));

  recentTrips?.forEach((t) => {
    activities.push({
      type: "trip",
      description: `New trip: ${t.title}`,
      timestamp: t.created_at,
    });
  });

  // Recent AI usage
  const { data: recentAi } = logReadError("admin stats: recent AI", await supabase
    .from("ai_usage")
    .select("action, created_at")
    .order("created_at", { ascending: false })
    .limit(5));

  recentAi?.forEach((a) => {
    activities.push({
      type: "ai",
      description: `AI action: ${a.action}`,
      timestamp: a.created_at,
    });
  });

  // Sort by timestamp and return top 15
  return activities
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 15);
}
