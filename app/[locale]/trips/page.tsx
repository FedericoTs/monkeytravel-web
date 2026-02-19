import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TripsPageClient from "@/components/trips/TripsPageClient";
import { getAllPosts } from "@/lib/blog/api";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Trips",
  robots: { index: false, follow: false },
};

export default async function TripsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Fetch user's trips (excluding archived trips)
  const { data: trips } = await supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .or("is_archived.is.null,is_archived.eq.false")
    .order("created_at", { ascending: false });

  // Fetch user profile with referral data
  const { data: profile } = await supabase
    .from("users")
    .select("display_name, avatar_url, lifetime_referral_conversions")
    .eq("id", user.id)
    .single();

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Traveler";
  const lifetimeConversions = profile?.lifetime_referral_conversions || 0;

  // Fetch latest 3 blog posts for Travel Guides section
  const allPosts = await getAllPosts(locale);
  const blogPosts = allPosts.slice(0, 3).map((p) => p.frontmatter);

  return (
    <TripsPageClient
      trips={trips || []}
      displayName={displayName}
      lifetimeConversions={lifetimeConversions}
      blogPosts={blogPosts}
    />
  );
}
