"use client";

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useNow } from "@/hooks/useNow";
import { shownTripStatus, tripTimeline } from "@/lib/trips/status";
import { toLocalISODate } from "@/lib/utils/date-local";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useTranslations, useLocale } from "next-intl";
import { Link, useRouter } from "@/lib/i18n/routing";
import Image from "next/image";
import { formatDateRange } from "@/lib/datetime";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import { PullToRefreshIndicator } from "@/components/ui/PullToRefreshIndicator";
import { hapticLight } from "@/lib/native/haptics";
import CuratedEscapes from "@/components/templates/CuratedEscapesClient";
import BlogTipsSection, { type BlogTip } from "@/components/blog/BlogTipsSection";
import ReferralModal from "@/components/referral/ReferralModal";
import TripActionModal from "@/components/trips/TripActionModal";
import TripCard, { type Trip } from "@/components/trips/TripCard";
import WaitingRoom from "@/components/trips/WaitingRoom";
import type { WaitingRoomTrip } from "@/lib/trips/waiting-room";

// Client-only import — the banner's localStorage-driven `isDismissed`
// state means the SSR + first-paint render emits a placeholder, then
// post-mount the real banner replaces it. Even after switching to a
// same-height placeholder (6cdc991), React 19's hydration matcher was
// still throwing #418 on /trips because the post-mount banner insertion
// shifted the dom enough that React couldn't reconcile the subtree
// against the SSR HTML. Marking ssr:false tells Next.js to skip the
// component entirely on the server and only mount it on the client —
// hydration has nothing to compare, so nothing can mismatch. The
// `loading` placeholder fills the same vertical space so layout doesn't
// jump when the real banner arrives. Allowed from a "use client"
// component (the ssr:false restriction is server-component only).
const ReferralProgressBanner = dynamic(
  () => import("@/components/bananas/ReferralProgressBanner"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[64px] mb-6 sm:mb-8" aria-hidden="true" />
    ),
  }
);

/** A trip someone else owns and invited this user to (trip_collaborators). */
interface SharedTrip {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  cover_image_url?: string;
  role: string;
}

interface TripsPageClientProps {
  trips: Trip[];
  /** Trips the user was invited to; no owner actions (archive/delete) on these. */
  sharedTrips?: SharedTrip[];
  displayName: string;
  lifetimeConversions: number;
  blogTips?: BlogTip[];
  /**
   * The visitor's day as the server reckons it (YYYY-MM-DD). The first render
   * and hydration sort trips into happening now / upcoming / past by it, so no
   * card moves after load.
   */
  serverToday?: string;
  /** The trip the home is about, when there is one (lib/trips/waiting-room.ts). */
  waitingRoom?: { trip: WaitingRoomTrip; holdout: boolean } | null;
}

type SortOption = "newest" | "oldest" | "upcoming" | "alphabetical";
type FilterStatus = "all" | "planning" | "confirmed" | "active" | "completed" | "cancelled";

/**
 * One timeline section of the grid. Module scope like TripCard: declared
 * inside TripsPageClient it was a new component type on every render, which
 * remounted the whole grid, its cover images included.
 */
function TripSection({ title, trips, icon, emptyText, renderTripCard }: {
  title: string;
  trips: Trip[];
  icon: React.ReactNode;
  emptyText?: string;
  renderTripCard: (trip: Trip) => React.ReactNode;
}) {
  if (trips.length === 0 && !emptyText) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <span className="text-sm text-slate-500">({trips.length})</span>
      </div>
      {trips.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {trips.map(renderTripCard)}
        </div>
      ) : emptyText ? (
        <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">{emptyText}</p>
        </div>
      ) : null}
    </div>
  );
}

export default function TripsPageClient({ trips, sharedTrips = [], displayName, lifetimeConversions, blogTips = [], waitingRoom, serverToday }: TripsPageClientProps) {
  const t = useTranslations('common.trips');
  const tRoles = useTranslations('common.roles');
  const tNav = useTranslations('common.navigation');
  const tA11y = useTranslations('common.a11y');
  // The locale for the date formatters: trip cards show "24-29 mag 2026" on
  // /it/.
  const locale = useLocale();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [referralModalOpen, setReferralModalOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Pull-to-refresh — the canonical iOS gesture. router.refresh() re-runs
  // the server component for /trips, picking up any new trips that were
  // added on another device or via collab. Light haptic confirms the
  // gesture landed before the refresh actually completes. No-op on
  // desktop (no touch events).
  const handlePullRefresh = useCallback(async () => {
    hapticLight();
    router.refresh();
    // router.refresh is synchronous from the caller's POV; give the
    // server a moment to respond so the spinner doesn't flash on/off.
    // 600ms is the empirical sweet spot — long enough to feel
    // intentional, short enough that snappy networks don't feel laggy.
    await new Promise((resolve) => setTimeout(resolve, 600));
  }, [router]);

  // Action modal state
  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    tripId: string;
    tripTitle: string;
    action: "archive" | "delete" | "unarchive";
  }>({
    isOpen: false,
    tripId: "",
    tripTitle: "",
    action: "archive",
  });

  // Pull-to-refresh is document-level, so it survives React subtree
  // state and fires even when a modal is open. Without `enabled` the
  // user could pull-inside an open modal — the spinner would render
  // at z-60 over the modal AND router.refresh() would race with any
  // in-flight modal mutation. Gate the gesture off while any of the
  // foreground UIs (trip-action modal, referral modal) are open.
  // Note: per-card `menuOpen` state lives inside TripCard so we can't
  // see it from here without lifting state; the modal gating closes
  // the worst of the bug. Day-2 audit P2.
  const { isRefreshing: ptrRefreshing, pullDistance: ptrDistance } =
    usePullToRefresh(handlePullRefresh, {
      threshold: 80,
      enabled: !actionModal.isOpen && !referralModalOpen,
    });

  // Handle trip actions
  const handleArchive = async (tripId: string) => {
    const response = await fetch(`/api/trips/${tripId}/archive`, {
      method: "POST",
    });
    if (response.ok) {
      router.refresh();
    } else {
      throw new Error("Failed to archive trip");
    }
  };

  const handleUnarchive = async (tripId: string) => {
    const response = await fetch(`/api/trips/${tripId}/archive`, {
      method: "DELETE",
    });
    if (response.ok) {
      router.refresh();
    } else {
      throw new Error("Failed to unarchive trip");
    }
  };

  const handleDelete = async (tripId: string) => {
    const response = await fetch(`/api/trips/${tripId}`, {
      method: "DELETE",
    });
    if (response.ok) {
      router.refresh();
    } else {
      throw new Error("Failed to delete trip");
    }
  };

  const openActionModal = (tripId: string, tripTitle: string, action: "archive" | "delete" | "unarchive") => {
    setActionModal({ isOpen: true, tripId, tripTitle, action });
  };

  const closeActionModal = () => {
    setActionModal({ ...actionModal, isOpen: false });
  };

  const confirmAction = async () => {
    const { tripId, action } = actionModal;
    switch (action) {
      case "archive":
        await handleArchive(tripId);
        break;
      case "unarchive":
        await handleUnarchive(tripId);
        break;
      case "delete":
        await handleDelete(tripId);
        break;
    }
  };

  // The server's day until mount, then the browser's (hooks/useNow.ts).
  // Server render and hydration share the server's value, so their buckets
  // match (no React error #418) and the cards are in their final sections
  // from the first paint instead of moving there after hydration.
  const clientNow = useNow();
  const today = clientNow ? toLocalISODate(clientNow) : serverToday ?? null;

  // Each trip with the status its dates give it, for the pill and the filter.
  const shownTrips = useMemo(
    () => (today ? trips.map(t => ({ ...t, status: shownTripStatus(t.status, t.start_date, t.end_date, today) })) : trips),
    [trips, today]
  );

  // Separate active and archived trips
  const activeTrips = useMemo(() => shownTrips.filter(t => !t.is_archived), [shownTrips]);
  const archivedTrips = useMemo(() => shownTrips.filter(t => t.is_archived), [shownTrips]);

  // Calculate trip statistics (only for active, non-archived trips).
  //
  // Time-bucket counts (upcoming/past/active) are null only without any clock
  // (no serverToday), and the render path then emits a `—` placeholder on both
  // sides. Server and hydration otherwise count with the same server day.
  //
  // Why null + render placeholder instead of `0` + suppressHydrationWarning:
  // empirically (fiber inspection in the browser),
  // `suppressHydrationWarning` ONLY silences the dev-mode console warning
  // in React 19. The recoverable error still throws in prod, gets caught
  // by error reporting, and pollutes Sentry. Rendering an identical text
  // node ("—") on both sides is the only bulletproof fix that doesn't
  // depend on React's hydration timing heuristics changing under us.
  const stats = useMemo(() => {
    if (!today) {
      return {
        total: activeTrips.length,
        upcoming: null,
        past: null,
        active: null,
        destinations: new Set(activeTrips.map(t => t.title.replace(/ Trip$/, ""))).size,
        archived: archivedTrips.length,
      };
    }
    const timelines = activeTrips.map(t => tripTimeline(t.start_date, t.end_date, today));
    const upcoming = timelines.filter(when => when === "upcoming").length;
    const past = timelines.filter(when => when === "past").length;
    const active = timelines.filter(when => when === "current").length;

    // Count unique destinations (extract from title)
    const destinations = new Set(activeTrips.map(t => t.title.replace(/ Trip$/, "")));

    return {
      total: activeTrips.length,
      upcoming,
      past,
      active,
      destinations: destinations.size,
      archived: archivedTrips.length,
    };
  }, [activeTrips, archivedTrips, today]);

  // Filter and sort trips (only non-archived trips)
  const filteredTrips = useMemo(() => {
    let result = [...activeTrips];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        t =>
          t.title.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (filterStatus !== "all") {
      result = result.filter(t => t.status === filterStatus);
    }

    // Sort
    switch (sortBy) {
      case "newest":
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case "oldest":
        result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case "upcoming":
        result.sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
        break;
      case "alphabetical":
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }

    return result;
  }, [activeTrips, searchQuery, sortBy, filterStatus]);

  // Group trips by timeline with the `today` from above. Only without any clock
  // (no serverToday) does everything start in `past`, identically on both sides.
  const groupedTrips = useMemo(() => {
    const upcoming: Trip[] = [];
    const current: Trip[] = [];
    const past: Trip[] = [];

    if (!today) {
      // Pre-hydration: lump everything into "past" (stable across SSR/client).
      filteredTrips.forEach(trip => past.push(trip));
      return { upcoming, current, past };
    }

    filteredTrips.forEach(trip => {
      const when = tripTimeline(trip.start_date, trip.end_date, today);

      if (when === "upcoming") {
        upcoming.push(trip);
      } else if (when === "past") {
        past.push(trip);
      } else {
        current.push(trip);
      }
    });

    return { upcoming, current, past };
  }, [filteredTrips, today]);

  // Get translated status label - "completed" displays as "Memories"
  const getStatusLabel = useCallback((status: string) => {
    if (status === 'completed') return t('memories');
    if (status === 'active') return t('active');
    return t(status as 'planning' | 'confirmed' | 'cancelled');
  }, [t]);

  // The first card on screen holds the largest image above the fold.
  const groupedView = filterStatus === "all" && !searchQuery;
  const firstTripId = groupedView
    ? (groupedTrips.current[0] ?? groupedTrips.upcoming[0] ?? groupedTrips.past[0])?.id
    : filteredTrips[0]?.id;

  const renderTripCard = useCallback((trip: Trip) => (
    <TripCard
      key={trip.id}
      trip={trip}
      t={t}
      locale={locale}
      getStatusLabel={getStatusLabel}
      onAction={openActionModal}
      priority={trip.id === firstTripId}
    />
    // openActionModal is a stable inline setter wrapper; intentionally
    // omitted so the callback identity stays stable across renders.
  ), [t, locale, getStatusLabel, firstTripId]);

  // Trips other people invited this user to. They have no owner actions
  // (archive/delete). Shown after the user's own trips, or first when the user
  // has none (someone who signed up to join a friend's trip).
  const sharedSection =
    sharedTrips.length > 0 ? (
      <section className="my-8 sm:my-12" data-testid="shared-with-you">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900">{t('sharedWithYou')}</h2>
        <p className="text-sm text-slate-600 mb-4">{t('sharedWithYouHint')}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sharedTrips.map((shared) => (
            <Link
              key={shared.id}
              href={`/trips/${shared.id}`}
              data-testid="shared-trip-card"
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 truncate">{shared.title}</p>
                <p className="text-sm text-slate-600 truncate">{formatDateRange(shared.start_date, shared.end_date, locale)}</p>
              </div>
              {(["editor", "voter", "viewer"] as const).includes(shared.role as "editor" | "voter" | "viewer") && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {tRoles(`${shared.role as "editor" | "voter" | "viewer"}.label`)}
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>
    ) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white overflow-x-hidden">
      {/* Pull-to-refresh indicator — fixed-position spinner that translates
          with the finger. Renders nothing when idle. Sits in front of the
          sticky header (z-60) so the spinner is visible during the
          gesture. */}
      <PullToRefreshIndicator
        distance={ptrDistance}
        isRefreshing={ptrRefreshing}
        threshold={80}
      />

      {/* AuthEventTracker used to be mounted here. It now lives in
          app/[locale]/layout.tsx so it sees the auth_event param on every
          landing page, not just this one. Mounting it in both places would
          double-count signups. */}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="MonkeyTravel"
              width={36}
              height={36}
              className="rounded-lg sm:w-10 sm:h-10"
            />
            <span className="font-bold text-lg sm:text-xl text-[var(--primary-ink)]">
              MonkeyTravel
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-slate-600 text-sm sm:text-base hidden xs:inline">{t('hi')}, {displayName}</span>
            <Link
              href="/profile"
              className="p-2 rounded-lg text-slate-500 hover:text-[var(--primary-ink)] hover:bg-[var(--primary)]/5 transition-colors"
              title={tNav('profile')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </Link>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-slate-500 hover:text-slate-700 text-xs sm:text-sm px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                {t('signOut')}
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {waitingRoom && today && <WaitingRoom trip={waitingRoom.trip} holdout={waitingRoom.holdout} today={today} />}

        {/* Stats Cards */}
        {activeTrips.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-[var(--primary-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                  </svg>
                </div>
                <span className="text-xs sm:text-sm text-slate-500">{t('total')}</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900">{stats.total}</div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="text-xs sm:text-sm text-slate-500">{t('upcoming')}</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900">
                {/* `null` placeholder pre-mount → renders as the em-dash. After
                    useNow() populates `today`, the memo emits the real count and
                    this re-renders. Both SSR and first client paint produce the
                    same character — hydration cannot mismatch. */}
                {stats.upcoming ?? "—"}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-xs sm:text-sm text-slate-500">{t('completed')}</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900">
                {stats.past ?? "—"}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                </div>
                <span className="text-xs sm:text-sm text-slate-500">{t('destinations')}</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900">{stats.destinations}</div>
            </div>
          </div>
        )}

        {/* Referral Progress Banner - Encourage invitations (HIGH PRIORITY) */}
        <ReferralProgressBanner
          lifetimeConversions={lifetimeConversions}
          className="mb-6 sm:mb-8"
          onInvite={() => setReferralModalOpen(true)}
        />

        {/* Someone who only has trips they were invited to sees those first. */}
        {activeTrips.length === 0 && sharedSection}

        {/* For new users: Show templates first for inspiration */}
        {activeTrips.length === 0 && archivedTrips.length === 0 && <CuratedEscapes />}

        {/* Page Header with Search */}
        <div className="flex flex-col gap-4 mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{t('yourTrips')}</h1>
              <p className="text-slate-600 text-sm sm:text-base mt-1">
                {t('manageItineraries')}
              </p>
            </div>
            {/* Hide on mobile when no trips (empty state has its own CTA) */}
            <Link
              href="/trips/new"
              className={`bg-[var(--primary)] text-white px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors flex items-center justify-center gap-2 w-full sm:w-auto shadow-lg shadow-[var(--primary)]/25 ${
                activeTrips.length === 0 ? "hidden sm:flex" : ""
              }`}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              {t('planNewTrip')}
            </Link>
          </div>

          {/* Search and Filters */}
          {activeTrips.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  aria-label={t('searchPlaceholder')}
                  placeholder={t('searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors bg-white"
                />
                {searchQuery && (
                  <button
                    aria-label={tA11y("clearSearch")}
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Filter Toggle (Mobile) */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="sm:hidden flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                {t('filters')}
                {(filterStatus !== "all" || sortBy !== "newest") && (
                  <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
                )}
              </button>

              {/* Sort & Filter (Desktop) */}
              <div className="hidden sm:flex items-center gap-3">
                <select
                  aria-label={t('sortBy')}
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none"
                >
                  <option value="newest">{t('newestFirst')}</option>
                  <option value="oldest">{t('oldestFirst')}</option>
                  <option value="upcoming">{t('byDate')}</option>
                  <option value="alphabetical">{t('alphabetical')}</option>
                </select>

                <select
                  aria-label={t('filterByStatus')}
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none"
                >
                  <option value="all">{t('allStatus')}</option>
                  <option value="planning">{t('planning')}</option>
                  <option value="confirmed">{t('confirmed')}</option>
                  <option value="active">{t('active')}</option>
                  <option value="completed">{t('completed')}</option>
                  <option value="cancelled">{t('cancelled')}</option>
                </select>
              </div>
            </div>
          )}

          {/* Mobile Filters Panel */}
          {showFilters && (
            <div className="sm:hidden bg-white rounded-xl border border-slate-200 p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">{t('sortBy')}</label>
                <select
                  aria-label={t('sortBy')}
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
                >
                  <option value="newest">{t('newestFirst')}</option>
                  <option value="oldest">{t('oldestFirst')}</option>
                  <option value="upcoming">{t('byDate')}</option>
                  <option value="alphabetical">{t('alphabetical')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">{t('filterByStatus')}</label>
                <select
                  aria-label={t('filterByStatus')}
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
                >
                  <option value="all">{t('allStatus')}</option>
                  <option value="planning">{t('planning')}</option>
                  <option value="confirmed">{t('confirmed')}</option>
                  <option value="active">{t('active')}</option>
                  <option value="completed">{t('completed')}</option>
                  <option value="cancelled">{t('cancelled')}</option>
                </select>
              </div>
              <button
                onClick={() => {
                  setSortBy("newest");
                  setFilterStatus("all");
                }}
                className="w-full text-sm text-[var(--primary-ink)] font-medium"
              >
                {t('resetFilters')}
              </button>
            </div>
          )}
        </div>

        {/* Active Filters Indicator */}
        {(filterStatus !== "all" || searchQuery) && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-sm text-slate-500">{t('showing')}</span>
            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-700">
                &quot;{searchQuery}&quot;
                <button aria-label={tA11y("clearSearch")} onClick={() => setSearchQuery("")} className="hover:text-slate-900">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            )}
            {filterStatus !== "all" && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-700">
                {getStatusLabel(filterStatus)}
                <button aria-label={tA11y("clearFilter")} onClick={() => setFilterStatus("all")} className="hover:text-slate-900">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            )}
            <span className="text-sm text-slate-500">({t('tripsCount', { count: filteredTrips.length })})</span>
          </div>
        )}

        {/* Trips Display */}
        {activeTrips.length > 0 ? (
          groupedView ? (
            // Grouped view (no filters active)
            <>
              {/* Current/Active Trips */}
              <TripSection
                title={t('happeningNow')}
                trips={groupedTrips.current}
                renderTripCard={renderTripCard}
                icon={
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                }
              />

              {/* Upcoming Trips */}
              <TripSection
                title={t('upcoming')}
                trips={groupedTrips.upcoming}
                renderTripCard={renderTripCard}
                icon={
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                }
                emptyText={t('noUpcomingTrips')}
              />

              {/* Past Trips */}
              <TripSection
                title={t('pastAdventures')}
                trips={groupedTrips.past}
                renderTripCard={renderTripCard}
                icon={
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                }
              />
            </>
          ) : (
            // Filtered/searched view
            filteredTrips.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {filteredTrips.map(renderTripCard)}
              </div>
            ) : (
              <div className="text-center py-12 sm:py-16 px-4">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">{t('noTripsFound')}</h2>
                <p className="text-slate-600 text-sm mb-4">
                  {t('adjustFilters')}
                </p>
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setFilterStatus("all");
                  }}
                  className="text-[var(--primary-ink)] font-medium hover:underline"
                >
                  {t('clearFilters')}
                </button>
              </div>
            )
          )
        ) : (
          /* Empty State */
          <div className="text-center py-8 sm:py-12 px-4">
            <div className="relative w-40 h-40 sm:w-52 sm:h-52 md:w-64 md:h-64 mx-auto mb-4 sm:mb-6">
              <Image
                src="/images/empty-state.png"
                alt={t('noTripsYet')}
                fill
                className="object-contain"
                priority
              />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-2">
              {t('noTripsYet')}
            </h2>
            <p className="text-slate-600 text-sm sm:text-base mb-6 sm:mb-8 max-w-md mx-auto">
              {t('noTripsDescription')}
            </p>
            <Link
              href="/trips/new"
              className="inline-flex items-center justify-center gap-2 bg-[var(--primary)] text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors w-full sm:w-auto max-w-xs shadow-lg shadow-[var(--primary)]/25"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              {t('planFirstTrip')}
            </Link>
            {/* Secondary CTA so first-time visitors with zero trips have a
                low-friction discovery path (browse community trips → fork) in
                parallel to the high-friction "Plan a trip from scratch" path. */}
            <div className="mt-3">
              <Link
                href="/explore"
                className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-[var(--primary-ink)] underline underline-offset-4 transition-colors"
              >
                {t('orBrowseExplore')} →
              </Link>
            </div>
          </div>
        )}

        {activeTrips.length > 0 && sharedSection}

        {/* Archived Trips Section */}
        {archivedTrips.length > 0 && (
          <div className="mt-8 sm:mt-12">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-700 transition-colors mb-4"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showArchived ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium">
                {showArchived ? t('hideArchived') : t('showArchived')}
              </span>
              <span className="text-sm text-slate-500">({archivedTrips.length})</span>
            </button>

            {showArchived && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center">
                    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900">{t('archivedSection')}</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 opacity-75">
                  {archivedTrips.map(renderTripCard)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Travel Guides & Tips from blog */}
        {blogTips.length > 0 && <BlogTipsSection tips={blogTips} />}

        {/* For users WITH trips: Show templates at the bottom for inspiration */}
        {activeTrips.length > 0 && <CuratedEscapes />}
      </main>

      {/* Referral Modal */}
      <ReferralModal
        isOpen={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
      />

      {/* Trip Action Modal */}
      <TripActionModal
        isOpen={actionModal.isOpen}
        onClose={closeActionModal}
        onConfirm={confirmAction}
        tripTitle={actionModal.tripTitle}
        action={actionModal.action}
      />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activePage="trips" />
    </div>
  );
}
