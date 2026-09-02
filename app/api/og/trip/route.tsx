import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTripDestination } from "@/lib/trips/destination";

/**
 * The social preview card for a shared trip.
 *
 * WHY THIS IS A ROUTE HANDLER AND NOT app/opengraph-image.tsx
 * ----------------------------------------------------------
 * The file convention is banned here, and lib/seo/og-image.ts says why: Next
 * merges metadata shallowly, so a page that declares its own `openGraph`
 * silently overrides the convention — and a previous attempt at
 * /opengraph-image and /twitter-image returned 404 in production even to
 * facebookexternalhit. Commit 565e9b2 recorded that and explicitly did not
 * diagnose it ("Reason for the 404 isn't worth debugging when a static file
 * works perfectly"), so the cause is still unknown.
 *
 * Rather than re-run that experiment, this lives under /api/, which
 * middleware.ts skips for i18n (shouldSkipIntl, `pathname.startsWith("/api/")`)
 * and which 39 other route groups already prove works in production. The page
 * references it as an explicit absolute URL, so nothing depends on convention
 * merging.
 *
 * WHY IT TAKES A SHARE TOKEN AND NOT TEXT
 * ---------------------------------------
 * Taking title/subtitle as query params would let anyone render arbitrary text
 * on a MonkeyTravel-branded 1200x630 card. The token is the capability that
 * already grants public read of this trip, so it grants nothing new, and the
 * numbers are read from the row rather than supplied by the caller — which
 * also means the card cannot drift from the page it advertises.
 */

export const runtime = "nodejs";

const W = 1200;
const H = 630;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INK = "#11161D";
const CORAL = "#FF6B6B";
const PAPER = "#FFFFFF";

type TripRow = {
  title: string | null;
  trip_meta: unknown;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  itinerary: unknown;
  budget: { total?: number; currency?: string } | null;
};

/** Absolute, because a scraper resolves nothing. */
function absolutise(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${origin}${url}`;
  return null;
}

function formatRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const s = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(s.getTime())) return null;
  const sTxt = s.toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  if (!end) return `${sTxt} ${s.getUTCFullYear()}`;
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(e.getTime())) return `${sTxt} ${s.getUTCFullYear()}`;
  const eTxt = e.toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  return `${sTxt} – ${eTxt} ${e.getUTCFullYear()}`;
}

/** The brand card, for a token that resolves to nothing. */
function fallback() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: INK,
          color: PAPER,
        }}
      >
        <div style={{ display: "flex", fontSize: 68, letterSpacing: -1 }}>MonkeyTravel</div>
        <div style={{ display: "flex", fontSize: 30, color: "#9AA5B1", marginTop: 14 }}>
          AI trip planning
        </div>
      </div>
    ),
    // Short cache: a token can start resolving later (a trip un-deleted, a
    // replica catching up), and a year-long cache of the generic card would
    // outlive the reason for it.
    { width: W, height: H, headers: { "Cache-Control": "public, max-age=300" } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token || !UUID_RE.test(token)) return fallback();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("trips")
    .select("title, trip_meta, start_date, end_date, cover_image_url, itinerary, budget")
    // share_token is uuid, and deleted_at is re-asserted because service_role
    // bypasses RLS entirely — without it this would render deleted trips.
    .eq("share_token", token)
    .is("deleted_at", null)
    .single<TripRow>();

  if (error || !data) return fallback();

  const destination = getTripDestination({ title: data.title, trip_meta: data.trip_meta });
  const itinerary = Array.isArray(data.itinerary) ? (data.itinerary as unknown[]) : [];
  const days = itinerary.length;
  const activities = itinerary.reduce<number>((sum, day) => {
    const acts = (day as { activities?: unknown[] })?.activities;
    return sum + (Array.isArray(acts) ? acts.length : 0);
  }, 0);

  const dates = formatRange(data.start_date, data.end_date);
  // The stored currency, deliberately. The page converts into the VIEWER's
  // preferred currency client-side with live Frankfurter rates (useCurrency),
  // which a scraper has no equivalent of - there is no viewer at unfurl time.
  // So the card shows what the trip was budgeted in, which is at least a fact
  // rather than a guess at someone's locale.
  const budgetTotal = typeof data.budget?.total === "number" ? data.budget.total : null;
  const currency = data.budget?.currency || "USD";

  // Nights is a DATE DIFF, not days - 1. The page derives it that way
  // (SharedTripView.tsx:356-360, ceil((end - start) / 86400000)) while days
  // comes from itinerary.length, and the two disagree on 22.8% of trips. A
  // card that contradicts the page it advertises is worse than one with a
  // missing pill, so this mirrors the page's formula exactly.
  let nights: number | null = null;
  if (data.start_date && data.end_date) {
    const st = new Date(`${data.start_date}T00:00:00Z`).getTime();
    const en = new Date(`${data.end_date}T00:00:00Z`).getTime();
    if (!Number.isNaN(st) && !Number.isNaN(en) && en >= st) {
      nights = Math.ceil((en - st) / 86_400_000);
    }
  }

  // Only facts that exist. A card that prints "0 activities" or an empty
  // budget pill is worse than a card that simply omits the row.
  const stats: string[] = [];
  if (days > 0) stats.push(nights !== null ? `${days}D · ${nights}N` : `${days} days`);
  if (activities > 0) stats.push(`${activities} activities`);
  if (budgetTotal && budgetTotal > 0) stats.push(`${Math.round(budgetTotal)} ${currency}`);

  const cover = absolutise(data.cover_image_url, url.origin);

  return new ImageResponse(
    (
      <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", background: INK }}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            width={W}
            height={H}
            style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover" }}
          />
        ) : null}

        {/* Scrim. Satori has no filter/backdrop support, so legibility has to
            come from a plain gradient over the photo. */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            width: W,
            height: H,
            background: "linear-gradient(180deg, rgba(17,22,29,0.15) 0%, rgba(17,22,29,0.55) 45%, rgba(17,22,29,0.92) 100%)",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            position: "absolute",
            left: 64,
            right: 64,
            bottom: 56,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
            <div style={{ display: "flex", width: 34, height: 5, background: CORAL, marginRight: 14 }} />
            <div style={{ display: "flex", fontSize: 22, color: "#E6EAEE", letterSpacing: 1.5 }}>
              MONKEYTRAVEL
            </div>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: destination.length > 22 ? 66 : 84,
              // No fontWeight. @vercel/og bundles exactly ONE face,
              // Geist-Regular.ttf (400) - verified at
              // node_modules/next/dist/compiled/@vercel/og/. Asking for 700
              // gets you faux-bold or nothing, so the hierarchy is carried by
              // size and the scrim instead. Shipping a display face is a
              // follow-up, not a silent fontWeight that does nothing.
              color: PAPER,
              lineHeight: 1.05,
            }}
          >
            {destination}
          </div>

          {dates ? (
            <div style={{ display: "flex", fontSize: 30, color: "#D2D8DE", marginTop: 12 }}>{dates}</div>
          ) : null}

          {/* flexWrap + flexShrink below: Satori defaults flexShrink to 0, not
              the CSS default of 1, so a wide pill row silently overflows the
              1200x630 canvas instead of shrinking. */}
          {stats.length > 0 ? (
            <div style={{ display: "flex", marginTop: 26, flexWrap: "wrap" }}>
              {stats.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    fontSize: 27,
                    color: PAPER,
                    background: "rgba(255,255,255,0.16)",
                    borderRadius: 999,
                    padding: "12px 24px",
                    marginRight: 14,
                    flexShrink: 1,
                  }}
                >
                  {s}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        // Scrapers cache aggressively anyway; this keeps repeat unfurls off
        // the function. s-maxage is what Vercel's CDN reads.
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
