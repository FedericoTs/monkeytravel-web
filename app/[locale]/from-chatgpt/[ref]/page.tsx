/**
 * ChatGPT Import Page
 * Landing page for users coming from ChatGPT MCP widget
 *
 * Flow:
 * 1. User clicks "Save to MonkeyTravel" in ChatGPT
 * 2. Lands here with ref param (itinerary ID)
 * 3. Fetches itinerary from mcp_itineraries table
 * 4. Shows welcome page with itinerary preview
 * 5. User signs up/logs in to claim the itinerary
 */

import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import ChatGPTImportClient from "./ChatGPTImportClient";
import { ogImages } from "@/lib/seo/og-image";

interface MCPItinerary {
  id: string;
  ref_id: string;
  destination: string;
  days: number;
  travel_style: string | null;
  interests: string[] | null;
  budget: string | null;
  itinerary: Array<{
    day: number;
    theme: string;
    activities: Array<{
      name: string;
      time: string;
      type: string;
      description: string;
      location?: string;
      tip?: string;
    }>;
  }>;
  summary: string | null;
  created_at: string;
  claimed_by: string | null;
}

// Generate metadata dynamically
export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string; locale: string }>;
}): Promise<Metadata> {
  const { ref, locale } = await params;
  const t = await getTranslations({ locale, namespace: "trips.chatgptImport.meta" });
  const supabase = await createClient();

  // Fetch itinerary for metadata
  const { data: itinerary } = await supabase
    .from("mcp_itineraries")
    .select("destination, days")
    .eq("ref_id", ref)
    .is("claimed_by", null)
    .single();

  if (!itinerary) {
    return {
      title: t("fallbackTitle"),
      description: t("fallbackDescription"),
    };
  }

  const values = { days: itinerary.days, destination: itinerary.destination };
  return {
    title: t("title", values),
    description: t("description", values),
    openGraph: {
      title: t("ogTitle", values),
      description: t("ogDescription"),
      images: ogImages(t("ogTitle", values)),
    },
  };
}

export default async function ChatGPTImportPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;

  // Validate ref format (should be UUID)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(ref)) {
    notFound();
  }

  const supabase = await createClient();

  // Fetch the itinerary
  const { data: itinerary, error } = await supabase
    .from("mcp_itineraries")
    .select("*")
    .eq("ref_id", ref)
    .is("claimed_by", null)
    .single();

  // Handle not found or already claimed
  if (error || !itinerary) {
    notFound();
  }

  // Pass to client component for interactive features
  return <ChatGPTImportClient itinerary={itinerary as MCPItinerary} />;
}
