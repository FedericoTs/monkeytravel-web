import { Link } from "@/lib/i18n/routing";

export const metadata = {
  title: "Trip Not Found",
  robots: { index: false, follow: false },
};

/**
 * Co-located not-found UI for the shared-trip route.
 *
 * Replaces the generic site-wide 404 monkey page with a friendly card
 * that matches the invite-page error layout — same visual language for
 * the same failure mode (a public link that doesn't resolve to anything).
 *
 * Caught in COLLAB_AUDIT B3: previously /invite/{invalid} showed a custom
 * branded card while /shared/{invalid} fell through to the generic global
 * 404. Two different failure UIs for what is conceptually the same event
 * — "this link no longer works" — was a small but real consistency tell.
 *
 * Triggered by app/[locale]/shared/[token]/page.tsx calling notFound()
 * when the share_token lookup returns nothing.
 */
export default function SharedTripNotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {/* Icon matches the invite-error layout (same warning triangle
            with exclamation) for visual parity per LIVE_AUDIT P2 —
            same conceptual failure mode (a public link that no longer
            resolves) should have the same iconography. */}
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          This shared trip isn&rsquo;t available
        </h1>
        <p className="text-slate-600 mb-8">
          The link may have expired or the owner stopped sharing this trip.
          Try asking them for a fresh link — or plan one of your own.
        </p>
        <Link
          href="/trips/new"
          className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Plan your own trip
        </Link>
      </div>
    </div>
  );
}
