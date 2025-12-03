import { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://monkeytravel.app";
  const currentDate = new Date().toISOString();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: currentDate,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: currentDate,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: currentDate,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/auth/login`,
      lastModified: currentDate,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/auth/signup`,
      lastModified: currentDate,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  // Dynamically fetch shared trips from Supabase
  let sharedTripPages: MetadataRoute.Sitemap = [];

  try {
    const supabase = await createClient();
    const { data: sharedTrips, error } = await supabase
      .from("trips")
      .select("share_token, shared_at, updated_at")
      .not("share_token", "is", null)
      .not("shared_at", "is", null)
      .order("shared_at", { ascending: false })
      .limit(1000); // Limit to prevent sitemap from getting too large

    if (!error && sharedTrips) {
      sharedTripPages = sharedTrips.map((trip) => ({
        url: `${baseUrl}/shared/${trip.share_token}`,
        lastModified: trip.updated_at || trip.shared_at || currentDate,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }));
    }
  } catch (e) {
    // Silently fail if Supabase is unavailable during build
    console.warn("Failed to fetch shared trips for sitemap:", e);
  }

  return [...staticPages, ...sharedTripPages];
}
