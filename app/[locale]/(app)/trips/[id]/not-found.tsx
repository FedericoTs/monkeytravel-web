import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/routing";

/**
 * Co-located not-found UI for /trips/[id]: page.tsx calls notFound() for a
 * signed-in visitor who is not a member of the trip (and for one that does
 * not exist, which RLS cannot tell apart). A signed-out visitor was sent to
 * sign in first, so the generic "page not found" read as a broken link to
 * someone who had just made an account to see a trip they were sent. This
 * says what happened and who can let them in.
 */
export default async function TripUnavailable() {
  const t = await getTranslations("trips.unavailable");
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-slate-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{t("title")}</h1>
        <p className="text-slate-600 mb-8">{t("body")}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/trips"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors w-full sm:w-auto"
          >
            {t("myTrips")}
          </Link>
          <Link
            href="/trips/new"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors w-full sm:w-auto"
          >
            {t("planTrip")}
          </Link>
        </div>
      </div>
    </div>
  );
}
