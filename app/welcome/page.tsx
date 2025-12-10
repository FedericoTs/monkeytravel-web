import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import WelcomeClient from "./WelcomeClient";

export const metadata: Metadata = {
  title: "Welcome to MonkeyTravel",
  description: "Get started with your AI-powered travel planning journey",
};

export default async function WelcomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Must be authenticated to see welcome page
  if (!user) {
    redirect("/auth/login?redirect=/welcome");
  }

  // Check if user already completed welcome
  const { data: profile } = await supabase
    .from("users")
    .select("display_name, email, welcome_completed, onboarding_completed, free_trips_remaining")
    .eq("id", user.id)
    .single();

  // If welcome already completed, redirect to appropriate destination
  if (profile?.welcome_completed) {
    if (!profile.onboarding_completed) {
      redirect("/onboarding");
    }
    redirect("/trips");
  }

  // Check if user already has beta access
  const { data: betaAccess } = await supabase
    .from("user_tester_access")
    .select("code_used")
    .eq("user_id", user.id)
    .single();

  return (
    <WelcomeClient
      userId={user.id}
      displayName={profile?.display_name || user.email?.split("@")[0] || "there"}
      email={profile?.email || user.email || ""}
      hasBetaAccess={!!betaAccess}
      betaCodeUsed={betaAccess?.code_used}
      hasCompletedOnboarding={profile?.onboarding_completed || false}
      freeTripsRemaining={profile?.free_trips_remaining || 0}
    />
  );
}
