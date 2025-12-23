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
import { createClient } from "@/lib/supabase/server";
import ChatGPTImportClient from "./ChatGPTImportClient";

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
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { ref } = await params;
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
      title: "Import Your Trip",
      description: "Save your ChatGPT-generated itinerary to MonkeyTravel",
    };
  }

  return {
    title: `Your ${itinerary.destination} Trip`,
    description: `Save your ${itinerary.days}-day ${itinerary.destination} itinerary to MonkeyTravel and start planning!`,
    openGraph: {
      title: `Your ${itinerary.days}-Day ${itinerary.destination} Itinerary`,
      description: `ChatGPT created this trip for you. Save it to MonkeyTravel to edit, share, and explore!`,
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
