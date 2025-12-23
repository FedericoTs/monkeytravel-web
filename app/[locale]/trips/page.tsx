import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TripsPageClient from "@/components/trips/TripsPageClient";

export default async function TripsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Fetch user's trips
  const { data: trips } = await supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Fetch user profile
  const { data: profile } = await supabase
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .single();

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Traveler";

  return <TripsPageClient trips={trips || []} displayName={displayName} />;
}
