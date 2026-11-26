import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { waitUntil } from "@vercel/functions";
import TripStoryView from "@/components/story/TripStoryView";
import { logSharedTripVisit, madeThisShareLink } from "@/lib/analytics/funnel-events";
import { classifySharedVisit, sharedBySomeone } from "@/lib/analytics/share-visit-classifier";
import type { Locale } from "@/lib/destinations/types";
import { routing } from "@/lib/i18n/routing-config";
import { ogImages, twitterImages } from "@/lib/seo/og-image";
import { buildTripStory } from "@/lib/story/trip-story";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedInUserId } from "@/lib/supabase/server";
import { likeThisDays, planOwnHref } from "@/lib/trips/plan-own";
import { isUuid } from "@/lib/utils/uuid";

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

interface StoryTrip {
  id: string;
  user_id: string | null;
  claim_token: string | null;
  title: string | null;
  trip_meta: unknown;
  start_date: string | null;
  end_date: string | null;
  itinerary: unknown;
}

// The share token is what already lets anyone with the link read this trip: the story shows nothing more.
// A read the database refuses is an error, not a trip that isn't there.
const getStoryTrip = cache(async (token: string): Promise<StoryTrip | null> => {
  if (!isUuid(token)) return null;
  const { data, error } = await createAdminClient()
    .from("trips")
    .select("id, user_id, claim_token, title, trip_meta, start_date, end_date, itinerary")
    .eq("share_token", token)
    .is("deleted_at", null)
    .maybeSingle<StoryTrip>();
  if (error) throw error;
  return data;
});

const storyLocale = (locale: string): Locale => (["en", "es", "it", "pt"].includes(locale) ? (locale as Locale) : "en");

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, token } = await params;
  const trip = await getStoryTrip(token);
  if (!trip) {
    const t = await getTranslations({ locale, namespace: "common.shared" });
    return { title: t("unavailable.metaTitle"), robots: { index: false, follow: false } };
  }
  const t = await getTranslations({ locale, namespace: "common.story" });
  const story = buildTripStory(trip, storyLocale(locale), token);
  // A story that opens on a guess keeps the place out of its link preview too.
  const title = story.guess ? t("metaTitleGuess") : t("metaTitle", { place: story.place });
  const description = t("metaDescription");
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { siteName: "MonkeyTravel", title, description, type: "website", images: ogImages(title) },
    twitter: { card: "summary_large_image", title, description, images: twitterImages },
  };
}

export default async function TripStoryPage({ params }: PageProps) {
  const { locale, token } = await params;
  const trip = await getStoryTrip(token);
  if (!trip) notFound();

  const viewerUserId = await signedInUserId();
  const isOwner = viewerUserId !== null && viewerUserId === trip.user_id;
  // A link made signed out has no owner: the browser that made it stands for one.
  const madeIt = isOwner || trip.user_id ? false : await madeThisShareLink(trip.id);

  const visitHeaders = await headers();
  const verdict = classifySharedVisit({
    userAgent: visitHeaders.get("user-agent"),
    secFetchDest: visitHeaders.get("sec-fetch-dest"),
    purpose: visitHeaders.get("purpose"),
    secPurpose: visitHeaders.get("sec-purpose"),
    isOwner,
    tripWasShared: sharedBySomeone(trip),
  });
  if (verdict === "counted" && !madeIt) waitUntil(logSharedTripVisit(trip.id, { crewAsk: false, story: true }));

  const story = buildTripStory(trip, storyLocale(locale), token);
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  return (
    <TripStoryView
      story={story}
      locale={locale}
      tripId={trip.id}
      planHref={planOwnHref({ destination: story.place, days: likeThisDays(undefined, story.place, story.dayCount), referralCode: null })}
      fullPlanHref={`/shared/${token}`}
      storyUrl={`https://monkeytravel.app${prefix}/shared/${token}/story`}
      mine={isOwner || madeIt}
    />
  );
}
