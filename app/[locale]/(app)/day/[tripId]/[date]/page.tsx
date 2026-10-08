import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import ActivityCard from "@/components/ActivityCard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { tripDayNumber, verifyDayLink } from "@/lib/trips/day-link";
import type { Activity } from "@/types";

/**
 * One day of a trip, read-only and without sign-in, opened from the in-trip
 * digest email. The signed link (lib/trips/day-link.ts) is the only access
 * check, and only that day's activities reach the page. Never indexed; it
 * sends no Referer, so the key in its URL does not leak to linked sites.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ locale: string; tripId: string; date: string }>;
  searchParams: Promise<{ k?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.tripDayPage" });
  return {
    // The root layout's title template appends the site name.
    title: t("metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

interface TripDay {
  destination: string;
  dayNumber: number;
  title: string;
  activities: Activity[];
  currency?: string;
}

async function loadTripDay(tripId: string, date: string): Promise<TripDay | null> {
  const { data, error } = await createAdminClient()
    .from("trips")
    .select("title, start_date, end_date, itinerary, budget")
    .eq("id", tripId.toLowerCase())
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;

  const dayNumber = tripDayNumber(data.start_date, data.end_date, date);
  if (dayNumber === null) return null;
  const days: unknown[] = Array.isArray(data.itinerary) ? data.itinerary : [];
  const day = days.find(
    (d): d is Record<string, unknown> =>
      !!d && typeof d === "object" && Number((d as Record<string, unknown>).day_number) === dayNumber,
  );
  const activities = Array.isArray(day?.activities) ? (day.activities as unknown[]) : [];
  const currency = (data.budget as { currency?: unknown } | null)?.currency;
  return {
    destination: (data.title ?? "").replace(/\s+Trip\s*$/i, "").trim(),
    dayNumber,
    title: typeof day?.title === "string" ? day.title.trim() : "",
    activities: activities.filter(
      (a): a is Activity => !!a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string",
    ),
    currency: typeof currency === "string" ? currency : undefined,
  };
}

function Notice({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <main className="min-h-screen min-h-dvh bg-[var(--background)] flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--foreground)] mb-2">{title}</h1>
        <p className="text-[var(--foreground-muted)] mb-8">{body}</p>
        <a
          href={href}
          className="inline-flex items-center justify-center px-6 py-3 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors"
        >
          {cta}
        </a>
      </div>
    </main>
  );
}

export default async function TripDayPage({ params, searchParams }: PageProps) {
  const { locale, tripId, date } = await params;
  const { k } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("common.tripDayPage");
  const prefix = locale === "en" ? "" : `/${locale}`;

  const check = verifyDayLink(tripId, date, typeof k === "string" ? k : null);
  const day = check.ok ? await loadTripDay(tripId, date) : null;
  if (!day) {
    return (
      <Notice
        title={check.ok ? t("unavailableTitle") : t("expiredTitle")}
        body={check.ok ? t("unavailableBody") : t("expiredBody")}
        href={`${prefix}/auth/login?redirect=${encodeURIComponent("/trips")}`}
        cta={t("signIn")}
      />
    );
  }

  // Signed-in visitors go straight to the trip; the trip page decides access.
  const tripPath = `/trips/${tripId.toLowerCase()}`;
  const { data: auth } = await (await createClient()).auth.getUser();
  const editHref = auth.user ? `${prefix}${tripPath}` : `${prefix}/auth/login?redirect=${encodeURIComponent(tripPath)}`;
  const format = await getFormatter();
  const when = format.dateTime(new Date(`${date}T00:00:00Z`), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  return (
    <main className="min-h-screen min-h-dvh bg-[var(--background)] px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        {day.destination ? (
          <p className="text-sm font-medium text-[var(--foreground-muted)]">{day.destination}</p>
        ) : null}
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-[var(--foreground)]">
          {t("heading", { day: day.dayNumber })}
        </h1>
        <p className="mt-1 text-[var(--foreground-muted)]">{day.title ? `${when} · ${day.title}` : when}</p>

        {day.activities.length > 0 ? (
          <div className="mt-6 space-y-3">
            {day.activities.map((activity, index) => (
              <ActivityCard
                key={activity.id ?? index}
                activity={activity}
                index={index}
                currency={day.currency}
                showGallery={false}
                disableAutoFetch
              />
            ))}
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-slate-200 bg-white p-5 text-[var(--foreground-muted)]">
            {t("empty")}
          </p>
        )}

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-center">
          <p className="text-sm text-[var(--foreground-muted)]">{t("readOnly")}</p>
          <a
            href={editHref}
            className="mt-3 inline-flex items-center justify-center px-6 py-3 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors"
          >
            {auth.user ? t("openTrip") : t("signInToEdit")}
          </a>
        </div>
      </div>
    </main>
  );
}
