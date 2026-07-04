import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTripDestination } from "@/lib/trips/destination";
import {
  generatePersonSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { buildAlternates } from "@/lib/seo/canonical";
import { getNonce } from "@/lib/security/nonce";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import CreatorProfile, {
  type CreatorProfileData,
} from "@/components/creator/CreatorProfile";

const SITE_URL = "https://monkeytravel.app";

/**
 * /creator/[username] — the PUBLIC, INDEXABLE creator-profile page.
 *
 * The "author hub" of the Wanderlog UGC-SEO machine: one crawlable page per
 * community creator, aggregating every itinerary they've published and
 * deep-linking to each `/trip/{public_slug}`. It gives Google an authorship
 * cluster and gives the creator a shareable identity page.
 *
 * 404 (notFound) conditions — ALL must pass to render:
 *   - a user row exists for lower(username)=lower(param)
 *   - privacy_settings->>'privateProfile' !== 'true'
 *   - the user has ≥1 published trip
 *
 * Only the public-safe column allowlist is ever selected — NEVER email or
 * payment handles.
 */

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ locale: string; username: string }>;
}

/** Published-trip predicate, shared with the sitemap + public trip page. */
const PUBLISHED_TRIP_FILTER = {
  visibility: "public",
} as const;

/**
 * Request-scoped cache: `generateMetadata` + render both resolve the same
 * creator. React `cache()` dedupes by username for the request lifetime.
 */
const getCreator = cache(async (username: string): Promise<CreatorProfileData | null> => {
  // Usernames are slugified to [a-z0-9-]. Reject anything else BEFORE touching
  // the DB: this short-circuits junk paths (favicons, scanners) without a query
  // AND stops raw URL input reaching `ilike` as a wildcard (`%`, `_`) pattern.
  if (!/^[a-zA-Z0-9-]{1,40}$/.test(username)) return null;

  const supabase = createAdminClient();

  // Case-insensitive username match. `ilike` with no wildcards is an exact
  // case-insensitive compare (username is UNIQUE case-insensitive in the DB).
  const { data: userRow, error } = await supabase
    .from("users")
    // Public-safe allowlist ONLY. Never email / paypal_handle / venmo_handle /
    // wise_handle / stripe_* / date_of_birth / current_location / preferences /
    // notification_settings.
    .select("id, username, display_name, avatar_url, bio, privacy_settings")
    .ilike("username", username)
    .maybeSingle();

  if (error || !userRow) return null;

  // Gate private profiles.
  const priv = (userRow.privacy_settings ?? {}) as Record<string, unknown>;
  if (String(priv.privateProfile ?? "") === "true") return null;

  // Fetch this creator's published trips, newest first.
  const { data: tripRows } = await supabase
    .from("trips")
    .select(
      "id, title, public_slug, cover_image_url, template_destination, trip_meta, like_count, save_count, created_at, shared_at",
    )
    .eq("user_id", userRow.id)
    .eq("visibility", PUBLISHED_TRIP_FILTER.visibility)
    .is("deleted_at", null)
    .not("public_slug", "is", null)
    .not("is_hidden", "is", true)
    .order("shared_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const rows = tripRows ?? [];

  // Zero published trips → no profile page (would be a thin, empty page).
  if (rows.length === 0) return null;

  const trips = rows
    .filter((r) => typeof r.public_slug === "string" && r.public_slug)
    .map((r) => ({
      id: r.id as string,
      publicSlug: r.public_slug as string,
      title: r.title as string,
      destination: getTripDestination({
        title: r.title as string,
        trip_meta: r.trip_meta,
      }),
      coverImage: (r.cover_image_url as string | null) ?? null,
      likeCount: (r.like_count as number | null) ?? 0,
      saveCount: (r.save_count as number | null) ?? 0,
    }));

  if (trips.length === 0) return null;

  const totalLikes = rows.reduce(
    (sum, r) => sum + ((r.like_count as number | null) ?? 0),
    0,
  );

  return {
    username: userRow.username as string,
    displayName: (userRow.display_name as string | null) ?? null,
    avatarUrl: (userRow.avatar_url as string | null) ?? null,
    bio: (userRow.bio as string | null) ?? null,
    publicTripCount: trips.length,
    totalLikes,
    trips,
  };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common.creator" });

  const creator = await getCreator(username);
  if (!creator) {
    return {
      title: t("notFoundTitle"),
      robots: { index: false, follow: false },
    };
  }

  const name = creator.displayName || t("fallbackName");
  // Canonicalise on the actual stored username casing, not the URL casing.
  const { canonical, languages } = buildAlternates(
    `/creator/${creator.username}`,
    { locale },
  );

  const title = t("metaTitle", { name });
  const description = t("metaDescription", {
    name,
    count: creator.publicTripCount,
  });
  const avatar = creator.avatarUrl ?? undefined;

  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      type: "profile",
      url: canonical,
      ...(avatar && {
        images: [{ url: avatar, width: 400, height: 400, alt: name }],
      }),
    },
    twitter: {
      card: "summary",
      title,
      description,
      ...(avatar && { images: [avatar] }),
    },
  };
}

export default async function CreatorPage({ params }: PageProps) {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common.creator" });

  const creator = await getCreator(username);
  if (!creator) {
    notFound();
  }

  const profileUrl = buildAlternates(`/creator/${creator.username}`, {
    locale,
  }).canonical;
  const name = creator.displayName || t("fallbackName");

  const personSchema = generatePersonSchema({
    name,
    url: profileUrl,
    ...(creator.bio ? { description: creator.bio } : {}),
    ...(creator.avatarUrl ? { image: creator.avatarUrl } : {}),
  });

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: t("breadcrumbHome"), url: `${SITE_URL}` },
    { name, url: profileUrl },
  ]);

  const nonce = await getNonce();

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <script {...jsonLdScriptProps(personSchema, nonce)} />
      <script {...jsonLdScriptProps(breadcrumbSchema, nonce)} />

      <Navbar />
      <main className="flex-1 w-full">
        <CreatorProfile creator={creator} locale={locale} />
      </main>
      <Footer />
      {/* Creator profiles are a discovery surface — highlight the Explore tab
          to keep the bottom-nav discovery loop coherent. */}
      <MobileBottomNav activePage="explore" />
    </div>
  );
}
