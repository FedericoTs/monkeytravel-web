import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TripsPageClient from "@/components/trips/TripsPageClient";
import { getAllFrontmatter } from "@/lib/blog/api";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// Locale-aware <title>. Previously a static export read "My Trips" for
// every locale — Italian browser tab showed English. Caught in audit
// 2026-05-29 (along with the /trips/new equivalent fix in 4c3e2a3+).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // Pull from common.trips namespace which already has the page title
  // localized (`myTrips`) since the navigation also references it.
  const t = await getTranslations({ locale, namespace: "common.navigation" });
  return {
    title: t("myTrips"),
    robots: { index: false, follow: false },
  };
}

export default async function TripsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Trips and profile are independent - both need only user.id - so they run
  // concurrently rather than stacked. Supabase is in us-west-1 while these
  // functions run in iad1: a round trip measured 118ms median in production
  // (27ms from a co-located region), so a needless second await is ~118ms of
  // pure waiting.
  //
  // Both results are always used now that the zero-trip redirect is gone, so
  // there is no longer a discarded-query case to caveat.
  const [tripsResult, profileResult] = await Promise.all([
    supabase
      .from("trips")
      .select("*")
      .eq("user_id", user.id)
      .or("is_archived.is.null,is_archived.eq.false")
      .order("created_at", { ascending: false }),
    supabase
      .from("users")
      .select("display_name, avatar_url, lifetime_referral_conversions")
      .eq("id", user.id)
      .single(),
  ]);

  const { data: trips } = tripsResult;

  // NO auto-redirect for zero-trip users. This used to be
  // `if (!trips?.length) redirect("/trips/new")`, which made the browser Back
  // button a trap: /trips/new -> Back -> /trips -> server redirect -> straight
  // back to /trips/new. A user with no trips could not leave the wizard by the
  // one control every browser gives them.
  //
  // It also hid a page that already exists and is better than the redirect.
  // TripsPageClient renders a full empty state - illustration, "plan your
  // first trip" as the primary CTA, and a low-friction "browse community
  // trips" secondary - which a zero-trip user had never once seen, because
  // this line sent them away before it could render.
  //
  // Post-signup landing is handled in the callback, NOT here. The first
  // version of this comment claimed app/auth/callback/route.ts rewrites
  // next="/trips" to "/trips/new" itself. It does not: that rewrite lives
  // inside the callback's `isNewUser` block, which cannot run because
  // handle_new_user creates public.users in the same transaction. Removing
  // the redirect therefore dropped fresh Google signups (42 of every 100,
  // the ones who use the login page) onto this empty list. The callback now
  // decides that itself — see lib/auth/first-login.ts — which is where the
  // decision belongs, since only the callback knows the account is new.
  // This page only changes what happens when someone deliberately navigates
  // to their trip list, and trapping them there was never the intent.

  const { data: profile } = profileResult;

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Traveler";
  const lifetimeConversions = profile?.lifetime_referral_conversions || 0;

  // Fetch latest 3 blog posts for Travel Guides section. Uses
  // getAllFrontmatter — the Travel Guides strip only renders title/cover/
  // excerpt/date/readingTime, all of which live in frontmatter. The full-
  // post variant parses 62 markdown bodies through remark/rehype per
  // request just for 3 to survive the .slice(0, 3), so we skip the
  // markdown processor entirely here.
  const blogPosts = getAllFrontmatter(locale).slice(0, 3);

  return (
    <TripsPageClient
      trips={trips || []}
      displayName={displayName}
      lifetimeConversions={lifetimeConversions}
      blogPosts={blogPosts}
    />
  );
}
