import { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { destinations } from "@/lib/destinations/data";
import { getAllSlugs as getBlogSlugs, getPostDates } from "@/lib/blog/api";

const locales = ["en", "es", "it"] as const;
const defaultLocale = "en";

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

  // Destination pages (index + detail × 3 locales)
  const destinationPages: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;

    // Index page per locale
    destinationPages.push({
      url: `${baseUrl}${prefix}/destinations`,
      lastModified: currentDate,
      changeFrequency: "weekly",
      priority: 0.8,
    });

    // Detail page per destination per locale
    for (const dest of destinations) {
      destinationPages.push({
        url: `${baseUrl}${prefix}/destinations/${dest.slug}`,
        lastModified: currentDate,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  // Blog pages (index + detail × 3 locales)
  const blogPages: MetadataRoute.Sitemap = [];
  const blogSlugs = getBlogSlugs();

  for (const locale of locales) {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;

    // Blog index page per locale
    blogPages.push({
      url: `${baseUrl}${prefix}/blog`,
      lastModified: currentDate,
      changeFrequency: "weekly",
      priority: 0.8,
    });

    // Blog detail page per post per locale
    for (const slug of blogSlugs) {
      const dates = getPostDates(slug);
      blogPages.push({
        url: `${baseUrl}${prefix}/blog/${slug}`,
        lastModified: dates?.updatedAt ?? currentDate,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

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

  return [...staticPages, ...destinationPages, ...blogPages, ...sharedTripPages];
}
