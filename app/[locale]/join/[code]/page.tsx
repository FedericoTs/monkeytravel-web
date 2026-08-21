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
      .from("public_profiles")
      .select("display_name")
      .eq("id", referralCode.user_id)
      .single();

    if (referrer) {
      referrerName = referrer.display_name;
    }
  }

  return {
    title: `${referrerName} invited you to MonkeyTravel!`,
    description: "Plan a trip together in about 30 seconds. 30 AI-planned itineraries a month, free — no card, no trial.",
    openGraph: {
      title: `${referrerName} invited you to MonkeyTravel!`,
      description: "Plan a trip together in about 30 seconds. 30 AI-planned itineraries a month, free — no card, no trial.",
      type: "website",
      images: ["/images/og-referral.jpg"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${referrerName} invited you to MonkeyTravel!`,
      description: "Plan a trip together in about 30 seconds. Free — no card, no trial.",
      // Matches this page's OWN openGraph image, not the site-wide card:
      // a referral landing page should preview as a referral.
      images: ["/images/og-referral.jpg"],
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
    .from("public_profiles")
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
