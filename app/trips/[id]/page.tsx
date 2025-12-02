import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { formatDateRange } from "@/lib/utils";
import type { ItineraryDay } from "@/types";
import TripDetailClient from "./TripDetailClient";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Fetch trip
  const { data: trip, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !trip) {
    notFound();
  }

  const itinerary = (trip.itinerary as ItineraryDay[]) || [];
  const budget = trip.budget as { total: number; currency: string } | null;

  return (
    <TripDetailClient
      trip={{
        id: trip.id,
        title: trip.title,
        description: trip.description,
        status: trip.status,
        startDate: trip.start_date,
        endDate: trip.end_date,
        tags: trip.tags,
        budget,
        itinerary,
      }}
      dateRange={formatDateRange(trip.start_date, trip.end_date)}
    />
  );
}
