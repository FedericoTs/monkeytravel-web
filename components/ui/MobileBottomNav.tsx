"use client";

import { Link } from "@/lib/i18n/routing";
import { useTranslations } from "next-intl";

interface MobileBottomNavProps {
  // Added "explore" 2026-05-30 (Phase B3 mobile): Booking/Airbnb both
  // use 5-tab bottom navs with Explore as a peer tab. Discovery loop
  // matters for retention — putting /explore in thumb-reach turns it
  // from a "marketing surface" into a real engagement surface.
  activePage:
    | "home"
    | "trips"
    | "new"
    | "explore"
    | "profile"
    | "trip-detail"
    | "saved";
  tripId?: string; // For trip detail page context
}

export default function MobileBottomNav({ activePage }: MobileBottomNavProps) {
  const t = useTranslations("common.bottomNav");
  // /saved is reachable from the bottom nav (via Profile) and the Navbar,
  // but it isn't one of the 5 primary tabs. Render the nav with NO
  // active tab so we don't mislead the user into thinking Profile is
  // the current page (the prior bug — Profile got aria-current + primary
  // color on /saved). When activePage='saved', isActive() returns false
  // for every tab.
  const isActive = (page: string) =>
    activePage !== "saved" && activePage === page;

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 sm:hidden z-50 pb-safe">
        {/* 5-tab layout matching Booking + Airbnb conventions:
            Home / Trips / [FAB Plan] / Explore / Profile.
            FAB stays centered (between Trips and Explore — index 2 of 5).
            justify-around evenly distributes the 5 children; the FAB's
            -mt-4 lifts the New button above the row, keeping the iconic
            elevated-CTA visual that converts well for primary actions. */}
        <div className="flex items-center justify-around py-2">
          {/* Home */}
          <Link
            href="/"
            className={`flex flex-col items-center gap-1 px-3 py-2 ${
              isActive("home") ? "text-[var(--primary)]" : "text-slate-500"
            }`}
            aria-label={t("home")}
            aria-current={isActive("home") ? "page" : undefined}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className={`text-xs ${isActive("home") ? "font-medium" : ""}`}>{t("home")}</span>
          </Link>

          {/* My Trips */}
          <Link
            href="/trips"
            className={`flex flex-col items-center gap-1 px-3 py-2 ${
              isActive("trips") || isActive("trip-detail") ? "text-[var(--primary)]" : "text-slate-500"
            }`}
            aria-label={t("myTrips")}
            aria-current={isActive("trips") || isActive("trip-detail") ? "page" : undefined}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className={`text-xs ${isActive("trips") || isActive("trip-detail") ? "font-medium" : ""}`}>{t("myTrips")}</span>
          </Link>

          {/* New Trip — elevated FAB. The primary action; deserves the
              center slot regardless of how many tabs flank it. */}
          <Link
            href="/trips/new"
            className={`flex flex-col items-center gap-1 px-3 py-2 ${
              isActive("new") ? "text-[var(--primary)]" : "text-slate-500"
            }`}
            aria-label={t("new")}
            aria-current={isActive("new") ? "page" : undefined}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center -mt-4 shadow-lg ${
              isActive("new")
                ? "bg-[var(--primary-dark)] shadow-[var(--primary)]/40"
                : "bg-[var(--primary)] shadow-[var(--primary)]/30"
            }`}>
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <span className={`text-xs ${isActive("new") ? "font-medium" : ""}`}>{t("new")}</span>
          </Link>

          {/* Explore — community/public trips. Compass icon is the
              category convention (Airbnb uses it for their Explore
              tab). Drives the discovery loop that grows the social
              graph. */}
          <Link
            href="/explore"
            className={`flex flex-col items-center gap-1 px-3 py-2 ${
              isActive("explore") ? "text-[var(--primary)]" : "text-slate-500"
            }`}
            aria-label={t("explore")}
            aria-current={isActive("explore") ? "page" : undefined}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l-2 6-6 2 2-6 6-2z" />
            </svg>
            <span className={`text-xs ${isActive("explore") ? "font-medium" : ""}`}>{t("explore")}</span>
          </Link>

          {/* Profile */}
          <Link
            href="/profile"
            className={`flex flex-col items-center gap-1 px-3 py-2 ${
              isActive("profile") ? "text-[var(--primary)]" : "text-slate-500"
            }`}
            aria-label={t("profile")}
            aria-current={isActive("profile") ? "page" : undefined}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className={`text-xs ${isActive("profile") ? "font-medium" : ""}`}>{t("profile")}</span>
          </Link>
        </div>
      </nav>

      {/* Bottom padding for mobile nav */}
      <div className="h-20 sm:hidden" />
    </>
  );
}
