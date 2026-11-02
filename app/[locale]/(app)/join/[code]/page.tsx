import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import ReferralLandingClient from "./ReferralLandingClient";
import { logReadError } from "@/lib/supabase/log-read-error";
import { isNoRow } from "@/lib/supabase/no-row";

interface PageProps {
  params: Promise<{ code: string; locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code, locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.referralLanding" });
  const supabase = await createClient();

  // Find the referrer. Codes are looked up here, on the server: only a
  // code's owner can read it from the client.
  const { data: referralCode } = logReadError("referral page metadata: code", await createAdminClient()
    .from("referral_codes")
    .select("user_id")
    .eq("code", code.toUpperCase())
    .single());

  let referrerName = t("friendFallback");

  if (referralCode) {
    const { data: referrer } = logReadError("referral page metadata: referrer", await supabase
      .from("public_profiles")
      .select("display_name")
      .eq("id", referralCode.user_id)
      .single());

    if (referrer?.display_name) {
      referrerName = referrer.display_name;
    }
  }

  const title = t("meta.title", { name: referrerName });
  return {
    title,
    description: t("meta.description"),
    openGraph: {
      siteName: "MonkeyTravel",
      title,
      description: t("meta.description"),
      type: "website",
      images: ["/images/og-referral.jpg"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: t("meta.shortDescription"),
      // Matches this page's OWN openGraph image, not the site-wide card:
      // a referral landing page should preview as a referral.
      images: ["/images/og-referral.jpg"],
    },
  };
}

export default async function ReferralLandingPage({ params }: PageProps) {
  const { code } = await params;
  const supabase = await createClient();

  // Find the referral code (on the server, as above)
  const { data: referralCode, error } = await createAdminClient()
    .from("referral_codes")
    .select("id, code, user_id")
    .eq("code", code.toUpperCase())
    .single();

  // A refused read is not an unknown code.
  if (error && !isNoRow(error)) throw error;
  if (!referralCode) {
    notFound();
  }

  // Get referrer info
  const { data: referrer } = logReadError("referral page: referrer", await supabase
    .from("public_profiles")
    .select("display_name, avatar_url")
    .eq("id", referralCode.user_id)
    .single());

  return (
    <ReferralLandingClient
      code={referralCode.code}
      referrerName={referrer?.display_name || null}
      referrerAvatar={referrer?.avatar_url}
    />
  );
}
