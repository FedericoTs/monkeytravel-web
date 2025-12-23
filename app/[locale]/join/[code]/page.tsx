import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ReferralLandingClient from "./ReferralLandingClient";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const supabase = await createClient();

  // Find the referrer
  const { data: referralCode } = await supabase
    .from("referral_codes")
    .select("user_id")
    .eq("code", code.toUpperCase())
    .single();

  let referrerName = "A friend";

  if (referralCode) {
    const { data: referrer } = await supabase
      .from("users")
      .select("display_name")
      .eq("id", referralCode.user_id)
      .single();

    if (referrer) {
      referrerName = referrer.display_name;
    }
  }

  return {
    title: `${referrerName} invited you to MonkeyTravel!`,
    description: "Get 1 FREE AI-generated trip when you sign up. Plan amazing adventures with AI-powered itineraries.",
    openGraph: {
      title: `${referrerName} invited you to MonkeyTravel!`,
      description: "Get 1 FREE AI-generated trip when you sign up. Plan amazing adventures with AI-powered itineraries.",
      type: "website",
      images: ["/images/og-referral.jpg"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${referrerName} invited you to MonkeyTravel!`,
      description: "Get 1 FREE AI-generated trip when you sign up.",
    },
  };
}

export default async function ReferralLandingPage({ params }: PageProps) {
  const { code } = await params;
  const supabase = await createClient();

  // Find the referral code
  const { data: referralCode, error } = await supabase
    .from("referral_codes")
    .select("id, code, user_id")
    .eq("code", code.toUpperCase())
    .single();

  if (error || !referralCode) {
    notFound();
  }

  // Get referrer info
  const { data: referrer } = await supabase
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", referralCode.user_id)
    .single();

  return (
    <ReferralLandingClient
      code={referralCode.code}
      referrerName={referrer?.display_name || "A friend"}
      referrerAvatar={referrer?.avatar_url}
    />
  );
}
