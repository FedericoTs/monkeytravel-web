"use client";

import { useState, useEffect, useRef, useCallback, type SetStateAction } from "react";
import { sanitizeIsoDate, maxTripStartDate } from "@/lib/dates/iso-date";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import dynamic from "next/dynamic";

// ./page.tsx resolves the optional `?destination=<slug>` deeplink server-side
// and passes only this payload in as `prefilledDestination`. Keep this file
// free of any import that pulls `lib/destinations/data`: it would drag the
// whole curated destinations dataset into the /trips/new client chunk.
export interface PrefilledDestination {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * The rest of the trip a blog CTA carried in (`?days=`, `?budget=`,
 * `?vibes=`), already validated server-side in ./page.tsx. Fields are null /
 * empty when the deeplink said nothing about them, which is the common case.
 */
export interface PrefilledTripShape {
  days: number | null;
  budget: "budget" | "balanced" | "premium" | null;
  vibes: string[];
}
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { prefs } from "@/lib/platform/storage";
import type { GeneratedItinerary, ItineraryDay, TripAnchor, TripCreationParams, TripVibe, SeasonalContext } from "@/types";
// Step-1 components (above-the-fold) stay eager.
import VibeSelector from "@/components/trip/VibeSelector";
import SeasonalContextCard from "@/components/trip/SeasonalContextCard";
import DestinationAutocomplete, { PlacePrediction } from "@/components/ui/DestinationAutocomplete";
import DateRangePicker from "@/components/ui/DateRangePicker";
import AnchorEditor from "@/components/trip/AnchorEditor";
import { buildSeasonalContext, getSeasonalVibeSuggestions } from "@/lib/seasonal";
import { streamGeneration } from "@/lib/streaming/client";
import { MultiCityRouteBuilder, type RouteStop } from "@/components/trips/MultiCityRouteBuilder";
import { JourneyRibbon } from "@/components/trips/JourneyRibbon";
import { buildJourneyStops } from "@/lib/ai/transfer-legs";
import { joinCities, splitCities, addDaysISO } from "@/lib/ai/multi-city-core";

// Multi-city planning (docs/MULTI_CITY_PLAN.md §2.5/§3.2). Env-gated so the
// single-city funnel is unchanged while the flag is off.
const MULTI_CITY_ENABLED = process.env.NEXT_PUBLIC_MULTI_CITY_ENABLED === "true";

// Keep in sync with the server-side cap in validateTripParams (lib/gemini.ts).
// Over the limit the API 400s with "Requirements text too long" and the wizard
// can only show a generic error, so the field enforces the cap client-side.
const REQUIREMENTS_MAX = 500;

// Post-generation and modal UI depends on user action or state, so it is split
// out of the initial wizard chunk to make the form paint faster. Those chunks
// would then land after the itinerary renders and pop in from zero height,
// shifting the page. Two defences, in order:
//   1. preloadResultViewChunks() fetches them during generation so they are
//      already warm when the result renders (the real fix);
//   2. the two that dominate the shift carry a correctly sized `loading` box,
//      so a slow network degrades to a skeleton instead of a jump.
// Heights are measured off the live components, not guessed:
//   hero  — 400px at every width (the component hard-codes h-[400px])
//   card  — 363px at 375w, 324px at 1280w
// The card is SHORTER on desktop despite its taller image (h-40 vs h-32)
// because the description wraps to fewer lines. Re-measure before touching
// either number: a placeholder of the WRONG height creates a shift instead of
// preventing one.
const HeroSkeleton = () => (
  <div
    className="h-[400px] w-full rounded-xl bg-slate-100 animate-pulse"
    aria-hidden="true"
  />
);
const ActivityCardSkeleton = () => (
  <div
    className="h-[363px] sm:h-[324px] w-full rounded-xl bg-slate-100 animate-pulse"
    aria-hidden="true"
  />
);
const DestinationHero = dynamic(() => import("@/components/DestinationHero"), {
  ssr: false,
  loading: () => <HeroSkeleton />,
});
const ActivityCard = dynamic(() => import("@/components/ActivityCard"), {
  ssr: false,
  loading: () => <ActivityCardSkeleton />,
});
const GenerationProgress = dynamic(() => import("@/components/trip/GenerationProgress"), { ssr: false });
const StartOverModal = dynamic(() => import("@/components/trip/StartOverModal"), { ssr: false });
const BaseModal = dynamic(() => import("@/components/ui/BaseModal"), { ssr: false });
const ChangeDatesModal = dynamic(() => import("@/components/trip/ChangeDatesModal"), { ssr: false });
const RegenerateButton = dynamic(() => import("@/components/trip/RegenerateButton"), { ssr: false });
// Export (PDF / iCal) on the result view, rendered only once the trip is saved.
// Client-only, no auth: it works on the in-memory generatedItinerary.
const ExportMenu = dynamic(() => import("@/components/trip/ExportMenu"), { ssr: false });
// AI Q&A and day-scoped edits on the wizard's result view.
const AnonAssistantPanel = dynamic(() => import("@/components/trip/AnonAssistantPanel"), { ssr: false });
// Session trips tray: result-view only, so it is code-split like the rest of
// the post-generation UI.
const SessionTripsTray = dynamic(() => import("@/components/trip/SessionTripsTray"), { ssr: false });
const ValuePropositionBanner = dynamic(() => import("@/components/trip/ValuePropositionBanner"), { ssr: false });
const AuthPromptModal = dynamic(() => import("@/components/ui/AuthPromptModal"), { ssr: false });
const PendingClaimBanner = dynamic(() => import("@/components/wizard/PendingClaimBanner"), { ssr: false });
// Share button for signed-out planners only, so it stays out of the bundle for
// signed-in users.
const AnonymousShareButton = dynamic(
  () => import("@/components/trip/AnonymousShareButton"),
  { ssr: false }
);

/**
 * Warm the result-view chunks while the itinerary is being generated.
 *
 * During generation the visitor watches GenerationProgress while the network
 * sits idle. Fetching the post-generation components in that window means they
 * resolve instantly when the result mounts, so nothing pops in from zero
 * height. It costs no extra bytes: these chunks download a moment later
 * anyway. Only handleGenerate calls it, so step-1-only visitors (the reason
 * this UI is split out at all) never fetch any of it.
 *
 * Deliberately fire-and-forget. Each rejection is swallowed because a failed
 * prefetch must be a non-event: dynamic() will simply load the chunk the
 * normal way, and an unhandled rejection here would surface as a bogus error.
 */
function preloadResultViewChunks(): void {
  const warm = (p: Promise<unknown>) => {
    p.catch(() => {});
  };
  warm(import("@/components/DestinationHero"));
  warm(import("@/components/ActivityCard"));
  warm(import("@/components/TripMap"));
  warm(import("@/components/trip/AnonAssistantPanel"));
  warm(import("@/components/trip/RegenerateButton"));
  warm(import("@/components/trip/ValuePropositionBanner"));
  warm(import("@/components/trip/ExportMenu"));
  warm(import("@/components/trip/AnonymousShareButton"));
}
import * as Sentry from "@sentry/nextjs";
import { useItineraryDraft, DraftRecoveryBanner } from "@/hooks/useItineraryDraft";
// Step-1 editorial entry; see lib/wizard/entry-state.ts for the arrival model.
import WizardMasthead from "@/components/wizard/WizardMasthead";
import OneTapStarts, { type OneTapPlace } from "@/components/wizard/OneTapStarts";
import ClaimedTripBanner from "@/components/wizard/ClaimedTripBanner";
import { useCssVarHeight } from "@/hooks/useCssVarHeight";
import {
  deriveEntryState,
  isFirstRunAuthEvent,
  pickMastheadVariant,
} from "@/lib/wizard/entry-state";
import {
  captureClaimedTripBanner,
  captureAnonShareKeepClicked,
  capturePendingClaimBanner,
  type AuthPromptLocation,
  captureWizardFirstRunViewed,
  captureWizardOneTapStart,
  captureAutoSaveSkipped,
} from "@/lib/posthog/events";
import { clearClaimedTrip, onClaimedTrip, readClaimedTrip } from "@/lib/trips/claimed-trip-signal";
import { readPendingClaim, type PendingClaim } from "@/lib/trips/anonymous-claim-client";
import { pendingClaimMatchesDraft, shouldDeferAutoSave, type ClaimResolution } from "@/lib/trips/pending-claim";
import { decideDraftRestore } from "@/lib/wizard/draft-restore";
import { isItinerarySaved } from "@/lib/wizard/draft-saved-check";
import { classifyGenerationFailure } from "@/lib/wizard/generation-failure";
// Session generation counter + per-session trip stack.
import { useSessionTripStack } from "@/hooks/useSessionTripStack";
import { useCurrency } from "@/lib/locale";
import WizardReplay from "@/components/trip/WizardReplay";
import {
  trackItineraryGenerated,
  trackTripCreated,
  trackDestinationSelected,
} from "@/lib/analytics";
import {
  captureTripCreated,
  captureTripUpdated,
  captureItineraryGenerated,
  captureTripWizardStepViewed,
  captureTripWizardStepCompleted,
  captureTripWizardAbandoned,
  captureTripWizardFieldInteracted,
  captureTripGenerationStarted,
  captureTripGenerationCompleted,
  captureTripIntentSelected,
  captureFirstTripSaved,
  captureAnchorsGenerated,
} from "@/lib/posthog/events";
import type { TripWizardFieldInteractedEvent, TripIntent } from "@/lib/posthog/events";
import {
  captureSaveBlockedAnon,
  captureSaveFailed,
  captureResultExitUnsaved,
  capture,
} from "@/lib/posthog/events";
import { handleTripCreatedWithReferral } from "@/lib/referral/client";
import { claimTripCreatedEmit } from "@/lib/analytics/tripCreatedDedup";
import { usePostHog } from "@/lib/posthog";
import { trackWizardEvent, type WizardEventStep } from "@/components/wizard/wizardEvents";
import { useAutoSaveTrip, type AutoSaveSkipReason } from "@/hooks/useAutoSaveTrip";
import { isSameDestination } from "@/lib/trips/sameDestination";
import { shouldAutoSave, shouldRedeemSaveIntent } from "@/lib/trips/autoSaveGate";
import { safeGet, safeSet } from "@/lib/safe-storage";
import {
  insertTrip as persistInsertTrip,
  updateTrip as persistUpdateTrip,
  deleteTrip as persistDeleteTrip,
  attachCoverImage as persistAttachCoverImage,
  type TripFormState as PersistTripFormState,
  type PersistInput,
} from "@/lib/trips/persistTrip";
import { resolveAiLanguage } from "@/lib/ai/language";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { applyAssistantEdits, type AssistantDayEdit } from "@/lib/trips/day-edit-merge";
import { planDateChange, moveItineraryDates } from "@/lib/trips/change-dates";

// Upper bound for the wizard start date (see lib/dates/iso-date.ts).
const MAX_TRIP_START_DATE = maxTripStartDate();

// Localized loading fallback for the lazy map. It renders inside the
// NextIntlClientProvider tree (it replaces TripMap in place while the chunk
// loads), so useTranslations resolves; an inline literal at module scope
// can't reach the translation context and would render raw English.
function MapLoadingFallback() {
  const t = useTranslations("trips");
  return (
    <div className="h-[350px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-500">{t("detail.loadingMap")}</span>
    </div>
  );
}

// Dynamic import for TripMap to avoid SSR issues
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => <MapLoadingFallback />,
});

// Localized, human date range for the result hero. Parses the ISO strings as
// LOCAL midnight (no trailing Z) to avoid an off-by-one, and joins with an
// en-dash so no English "to" (and no raw ISO date) leaks on /it /es /pt.
// Falls back to the raw range if either date is unparseable.
function formatDateRangeLocalized(startISO: string, endISO: string, locale: string): string {
  try {
    const start = new Date(`${startISO}T00:00:00`);
    const end = new Date(`${endISO}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return `${startISO} – ${endISO}`;
    }
    const fmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  } catch {
    return `${startISO} – ${endISO}`;
  }
}

// True inside the Capacitor native shell (iOS/Android WebView). Inline check
// mirrors lib/platform/storage.ts / PushOptInSheet.tsx — the `Capacitor`
// global is injected by the runtime; in a plain browser it's undefined.
// Used to skip the beforeunload leave-guard: WebViews don't render the
// native leave dialog and some hang on preventDefault'd beforeunload.
function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

// Small amber "● Not saved" pill rendered next to the Save button (desktop
// sticky header + mobile bottom bar) while the displayed itinerary is unsaved,
// in both the manual and the auto-save arm. Subtle pulse on the dot only.
function NotSavedPill({ className = "" }: { className?: string }) {
  const t = useTranslations("trips");
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
      {t("wizard.result.notSavedPill")}
    </span>
  );
}

// Vibe to interests mapping - automatically derives interests from selected vibes
// This ensures the AI receives relevant interest signals based on vibe selection
// Streamlined to 6 core vibes for cleaner UX
const VIBE_TO_INTERESTS: Record<string, string[]> = {
  adventure: ["adventure", "nature", "photography"],
  cultural: ["culture", "history", "art"],
  foodie: ["food", "culture"],
  romantic: ["relaxation", "photography"],
  nature: ["nature", "photography", "adventure"],
  urban: ["nightlife", "shopping", "art"],
};

// Budget tier styling - labels/descriptions come from translations
const BUDGET_TIER_STYLES = {
  budget: {
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-500",
  },
  balanced: {
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-500",
  },
  premium: {
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-500",
  },
} as const;

const BUDGET_TIER_IDS = ["budget", "balanced", "premium"] as const;
const PACE_OPTION_IDS = ["relaxed", "moderate", "active"] as const;

// ── Inline mirrors of lib/gemini.ts validateTripParams ──────────────────────
// The wizard enforces the server's rules inline so a bad duration or
// destination is flagged while the form is being filled, not at generate time;
// the lib checks stay as the server backstop. Keep BOTH in lockstep with
// lib/gemini.ts.
const MAX_TRIP_DAYS = 14;
// Multi-city ceiling: per-city parallel generation keeps each leg small, so
// the WHOLE-TRIP span may exceed the single-city limit. Server mirror:
// /api/ai/generate passes maxDays 21 to validateTripParams for multi-city.
const MAX_TRIP_DAYS_MULTI = 21;

// Popular-destination pills for step 1: the most-planned destinations on the
// platform plus two seasonal favourites (Santorini, Lisbon). Keep the list
// sourced from real planning demand, never a fabricated ranking. Each carries
// coords so tapping a pill skips a geocode. `season` = months where a spot is
// a standout; seasonalPopular() surfaces in-season picks first.
type SeasonalPopular = {
  name: string;
  flag: string;
  coords: { latitude: number; longitude: number };
  season: number[];
};

const SEASONAL_POPULAR: SeasonalPopular[] = [
  { name: "Tokyo, Japan", flag: "🇯🇵", coords: { latitude: 35.6762, longitude: 139.6503 }, season: [3, 4, 10, 11] },
  { name: "Paris, France", flag: "🇫🇷", coords: { latitude: 48.8566, longitude: 2.3522 }, season: [] },
  { name: "London, United Kingdom", flag: "🇬🇧", coords: { latitude: 51.5074, longitude: -0.1278 }, season: [] },
  { name: "Rome, Italy", flag: "🇮🇹", coords: { latitude: 41.9028, longitude: 12.4964 }, season: [4, 5, 9, 10] },
  { name: "Barcelona, Spain", flag: "🇪🇸", coords: { latitude: 41.3851, longitude: 2.1734 }, season: [5, 6, 7, 8, 9] },
  { name: "Santorini, Greece", flag: "🇬🇷", coords: { latitude: 36.3932, longitude: 25.4615 }, season: [5, 6, 7, 8, 9] },
  { name: "Bali, Indonesia", flag: "🇮🇩", coords: { latitude: -8.4095, longitude: 115.1889 }, season: [4, 5, 6, 7, 8, 9, 10] },
  { name: "Bangkok, Thailand", flag: "🇹🇭", coords: { latitude: 13.7563, longitude: 100.5018 }, season: [11, 12, 1, 2] },
  { name: "New York, USA", flag: "🇺🇸", coords: { latitude: 40.7128, longitude: -74.0060 }, season: [] },
  { name: "Lisbon, Portugal", flag: "🇵🇹", coords: { latitude: 38.7223, longitude: -9.1393 }, season: [3, 4, 5, 6, 9, 10] },
];

// In-season picks first (stable within each group), then take `limit`. Cheap,
// deterministic, and honest — it only reorders the real demand list.
function seasonalPopular(month: number, limit = 6): SeasonalPopular[] {
  const inSeason = SEASONAL_POPULAR.filter((d) => d.season.includes(month));
  const rest = SEASONAL_POPULAR.filter((d) => !d.season.includes(month));
  return [...inSeason, ...rest].slice(0, limit);
}

// Exact copy of DESTINATION_ALLOWLIST in lib/gemini.ts — letters, spaces,
// hyphens, commas, dots, parentheses, apostrophes, &, /, digits.
const DESTINATION_ALLOWLIST = /^[\p{L}\p{M}\s\-,.'()&/0-9]+$/u;
// The server's destination length rule (lib/gemini.ts validateTripParams).
// Unmirrored, a pasted prompt passes the gate, starts generating, and bounces
// off the server with an untranslated "Destination name too long" behind a
// Retry button that resends the same text. Keep it at 100, exactly where the
// server puts it: a lower bound would block names that generate fine.
const DESTINATION_MAX_LENGTH = 100;

// Day-inclusive trip span, matching the server's math (ceil(diff/day) + 1).
// Returns 0 for missing/unparseable dates.
function tripSpanDaysInclusive(startISO: string, endISO: string): number {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

// LOAD-BEARING: declared OUTSIDE the component so the array identity is stable
// across renders. A new reference per render would recreate
// trackFieldInteraction and handleVibesChange (breaking VibeSelector's
// React.memo, which stalls step-2 vibe clicks) and re-fire the abandonment
// effect, tearing down and re-attaching its window listeners every render.
const STEP_NAMES_CONST = ["destination_dates", "vibes_preferences"] as const;

// Server-side funnel mirror (trackWizardEvent + WizardEventStep) lives in
// @/components/wizard/wizardEvents. Every row is stamped front_door = "wizard"
// because the funnel SQL filters on that value. See
// app/api/wizard-event/route.ts and the wizard_step_events /
// wizard_event_front_door migrations.

interface NewTripWizardProps {
  /**
   * Server-resolved destination metadata from the optional
   * `?destination=<slug>` deeplink. Resolved in `page.tsx` (server
   * component) against the curated destinations dataset so the heavy
   * data module stays out of this client bundle.
   *
   * `null` when no deeplink was provided OR the slug didn't match a
   * known destination (free-text fallback handled below).
   */
  prefilledDestination: PrefilledDestination | null;
  /**
   * Trip length / budget / vibes carried in from a blog CTA, so a reader who
   * just finished "3-day Paris itinerary" doesn't have to retype the trip the
   * article described. Derived and validated upstream — see
   * lib/blog/trip-prefill.ts and the parser in ./page.tsx.
   */
  prefilledTripShape?: PrefilledTripShape;
}

export default function NewTripPage({
  prefilledDestination,
  prefilledTripShape,
}: NewTripWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Snapshot ?auth_event on the FIRST render. AuthEventTracker strips it with
  // history.replaceState as soon as auth resolves, and useSearchParams follows
  // — so a live read a few hundred milliseconds later sees nothing and a
  // brand-new account is indistinguishable from a cold visit. A useState
  // initialiser runs exactly once, before the tracker's effect.
  const [authEventAtMount] = useState<string | null>(() =>
    searchParams?.get("auth_event") ?? null
  );
  // Same latch for "did an article carry a destination in": the prefill
  // effects below fill the field a tick later, so a live `destination` read
  // cannot tell a prefill from a typed one.
  const [prefillAtMount] = useState<boolean>(() =>
    Boolean(prefilledDestination || searchParams?.get("destination"))
  );
  const isFreshSignup = isFirstRunAuthEvent(authEventAtMount);
  const mastheadVariant = pickMastheadVariant({ authEventAtMount, prefillAtMount });
  // The trip a signup claimed (see lib/trips/claimed-trip-signal.ts). State
  // lives up here because the PostHog super-property effect reads it.
  const [claimedTripId, setClaimedTripId] = useState<string | null>(null);
  const t = useTranslations("trips");
  // Locale is forwarded into the wizard_step_events rows so the funnel
  // can be sliced by language without joining back to URL paths. See
  // /api/wizard-event + the trackWizardEvent helper above.
  const locale = useLocale();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedItinerary, setGeneratedItineraryRaw] = useState<GeneratedItinerary | null>(null);
  // Activity ids are given here, once, so the auto-save insert, every later
  // update and the share link carry the SAME ids; fresh random ids on each
  // update would move itinerary_version and cut off anything keyed by id. The
  // object is only rebuilt when an id is actually missing, so a no-op set
  // does not look like a new itinerary to the auto-save.
  const setGeneratedItinerary = useCallback((next: SetStateAction<GeneratedItinerary | null>) => {
    setGeneratedItineraryRaw((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (!value || !Array.isArray(value.days)) return value;
      const missing = value.days.some(
        (d) => Array.isArray(d?.activities) && d.activities.some((a) => a && typeof a === "object" && !a.id)
      );
      return missing ? { ...value, days: ensureActivityIds(value.days) } : value;
    });
  }, []);
  // Result-view UX state (parity with /trips/template/[id]): users can hide
  // the map (mobile screen real estate) and pick Cards or Timeline.
  const [showMap, setShowMap] = useState(true);
  const [resultViewMode, setResultViewMode] = useState<"cards" | "timeline">("cards");
  // Streaming progress — set by the SSE consumer in handleGenerate. The
  // GenerationProgress component reads these to show real progress
  // ("Day 3 of 7") instead of fake-percentage phases.
  const [streamedDayCount, setStreamedDayCount] = useState(0);
  const [streamedTotalDays, setStreamedTotalDays] = useState(0);

  // Solo vs group intent. Captured as PostHog `trip_intent_selected`,
  // forwarded as group_size / trip_intent on later events and saved with the
  // trip, so collab demand is measurable. Group intent also shows an invite
  // hint in step 1 and puts the anonymous share button in crew mode.
  // "unspecified" = user clicked Continue without touching the toggle.
  const [tripIntent, setTripIntent] = useState<TripIntent>("unspecified");

  // Auth state comes from the single AuthProvider, not a local getUser()
  // listener. isAuthenticated is tri-state (null = loading, then true/false);
  // the JSX gating relies on null meaning "not known yet".
  const { user: authUser, loading: authLoading } = useAuth();
  const isAuthenticated: boolean | null = authLoading ? null : !!authUser;

  // Every event is stamped front_door = "wizard" (in wizard_step_events via
  // wizardEvents.ts and in PostHog via the super-property below) because the
  // funnel SQL and existing insights filter on it.
  //
  // Nothing fires before the auth state is known: wizard_entry (registered
  // below) derives from it, so an event fired on mount would record a
  // placeholder and skew the split.
  const entryResolved = isAuthenticated !== null;
  // Super-properties on every PostHog capture() + $pageview, so the funnel is
  // sliceable with no per-call edits. posthog may be undefined before init
  // (lazy-loaded) — guard + re-run when it resolves.
  const posthog = usePostHog();
  useEffect(() => {
    if (!posthog) return;
    if (!entryResolved) return;
    // wizard_entry makes every capture sliceable by how the person arrived,
    // with no per-call edits.
    posthog.register({
      front_door: "wizard",
      wizard_entry: deriveEntryState({ authEventAtMount, prefillAtMount, claimedTripId, isAuthenticated }),
    });
  }, [posthog, entryResolved, authEventAtMount, prefillAtMount, claimedTripId, isAuthenticated]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [hasExistingTrips, setHasExistingTrips] = useState(false);
  const [showReturningUserBanner, setShowReturningUserBanner] = useState(true);

  // ── Claimed trip ──────────────────────────────────────────────────────────
  // AuthProvider claims a pending anonymous trip on SIGNED_IN and publishes
  // the id (lib/trips/claimed-trip-signal.ts). The two sides race — SIGNED_IN
  // usually fires during hydration, before this effect subscribes — so read
  // the stored id AND subscribe. The post-callback landing may emit SIGNED_IN
  // or INITIAL_SESSION, so a fresh signup also claims directly, once:
  // claimPendingTrip is idempotent (the token is removed on any terminal
  // outcome, kept only on 401).
  useEffect(() => {
    const stored = readClaimedTrip();
    if (stored) setClaimedTripId(stored);
    return onClaimedTrip((id) => setClaimedTripId(id));
  }, []);
  const directClaimFiredRef = useRef(false);
  useEffect(() => {
    if (!isFreshSignup || authLoading || !authUser || directClaimFiredRef.current) return;
    directClaimFiredRef.current = true;
    void import("@/lib/trips/anonymous-claim-client")
      .then(({ claimPendingTrip }) => claimPendingTrip())
      .then((id) => {
        if (id) setClaimedTripId(id);
      })
      .catch(() => undefined);
  }, [isFreshSignup, authLoading, authUser]);
  const claimedSurfacedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!claimedTripId || claimedSurfacedRef.current === claimedTripId) return;
    claimedSurfacedRef.current = claimedTripId;
    void captureClaimedTripBanner({ action: "surfaced", trip_id: claimedTripId });
  }, [claimedTripId]);
  const dismissClaimedTrip = (action: "opened" | "plan_another" | "dismissed") => {
    if (claimedTripId) void captureClaimedTripBanner({ action, trip_id: claimedTripId });
    clearClaimedTrip();
    setClaimedTripId(null);
  };

  // First-run view, once per mount. Keyed on the latched param, not on auth
  // state, so it fires only for someone who just created an account.
  const firstRunViewedRef = useRef(false);
  useEffect(() => {
    if (!isFreshSignup || firstRunViewedRef.current) return;
    firstRunViewedRef.current = true;
    void captureWizardFirstRunViewed({ auth_event: authEventAtMount ?? "" });
  }, [isFreshSignup, authEventAtMount]);

  // Personalization preferences live in profile settings; the AI generation
  // API reads them from the database, so the wizard does not send them.


  // Form state
  const [destination, setDestination] = useState("");
  const [destinationCoords, setDestinationCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  // Multi-city: a route of city+nights rows. Only surfaced in step 1 when
  // MULTI_CITY_ENABLED; a sync effect below keeps `destination`/`endDate`
  // consistent so the rest of the wizard flow is untouched.
  const [multiCityMode, setMultiCityMode] = useState(false);
  const [cityRows, setCityRows] = useState<RouteStop[]>([
    { city: "", nights: 3 },
    { city: "", nights: 2 },
  ]);
  // Anchored trips: fixed commitments (flights, weddings, booked nights) the
  // generated plan must build around. Collapsed AnchorEditor on step 1; sent
  // to /api/ai/generate, and carried into trip_meta.anchors at save via
  // autoSaveFormState, which must list them or saved trips lose them.
  const [anchors, setAnchors] = useState<TripAnchor[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // "I'm flexible" escape hatch for the required-dates gate (step 1). Tracks
  // whether the current dates were auto-filled as a flexible default so we can
  // surface an editable "flexible dates" note.
  const [flexibleDates, setFlexibleDates] = useState(false);
  // Popular-destination pills: real demand-ranked, reordered by season on the
  // client. The initial SSR slice is stable (avoids a hydration mismatch); the
  // effect reorders after mount. `plannedStat` is an honest, aggregate
  // (GDPR-safe) social-proof count from /api/wizard/planning-stats.
  const [popularPicks, setPopularPicks] = useState<SeasonalPopular[]>(
    () => SEASONAL_POPULAR.slice(0, 6)
  );
  const [plannedStat, setPlannedStat] = useState<number | null>(null);
  // null on the server and first client paint; set in the same effect that
  // reorders the picks, so the "In season" badge is never a hydration diff.
  const [inSeasonMonth, setInSeasonMonth] = useState<number | null>(null);
  useEffect(() => {
    const month = new Date().getMonth() + 1;
    setPopularPicks(seasonalPopular(month));
    setInSeasonMonth(month);
    let alive = true;
    fetch("/api/wizard/planning-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.plannedLast30d === "number") {
          setPlannedStat(d.plannedLast30d);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [budgetTier, setBudgetTier] = useState<"budget" | "balanced" | "premium">("balanced");
  // Backpacker Mode. Default "classic"; "backpacker" (a) passes travelStyle to
  // the generate API so Gemini gets the backpacker directive, (b) persists
  // travel_style into trip_meta. It arrives with a restored draft or
  // session-tray snapshot; the step-1 toggle only shows while it is active.
  const [travelStyle, setTravelStyle] = useState<"classic" | "backpacker">("classic");
  const [pace, setPace] = useState<"relaxed" | "moderate" | "active">("moderate");
  const [selectedVibes, setSelectedVibes] = useState<TripVibe[]>([]);
  const [requirements, setRequirements] = useState("");
  // Must-do wishlist: undated wishes ("Great Wall", "eat Peking duck")
  // entered as chips on step 2. Distinct from anchors (date-pinned) and from
  // the requirements prose. Caps mirror validateTripParams (10 × 80 chars).
  const [mustDos, setMustDos] = useState<string[]>([]);
  const [mustDoInput, setMustDoInput] = useState("");
  const [seasonalContext, setSeasonalContext] = useState<SeasonalContext | null>(null);

  // UX enhancement state
  const [showStartOverModal, setShowStartOverModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showDraftRecovery, setShowDraftRecovery] = useState(false);
  const [draftAutoRestored, setDraftAutoRestored] = useState(false);

  // Id of the trip once either save arm has stored it (or a claimed trip is
  // adopted); null while the result is unsaved.
  const [savedTripId, setSavedTripId] = useState<string | null>(null);

  // LocalStorage draft persistence
  const { draft, saveDraft, clearDraft, hasDraft, isExpired } = useItineraryDraft();

  // Session generation counter + session trip stack (sessionStorage-backed;
  // all callbacks referentially stable).
  const {
    trips: sessionTrips,
    currentId: sessionTripCurrentId,
    bumpGenCount,
    getGenCount,
    recordGeneration: recordSessionGeneration,
    registerRestore: registerSessionRestore,
    swapTo: swapSessionTrip,
    clearCurrent: clearSessionTripCurrent,
  } = useSessionTripStack();

  // Currency conversion hook - converts prices to user's preferred currency
  const { convert: convertCurrency } = useCurrency();

  // 2-step wizard: Destination+Dates -> Vibes+Preferences.
  const TOTAL_STEPS = 2;

  // STEP_NAMES_CONST is hoisted to module scope above the component
  // — see the load-bearing comment there. Don't redeclare it here.

  // Collapsible preferences state (budget/pace/requirements shown on demand in step 2)
  const [showAdvancedPrefs, setShowAdvancedPrefs] = useState(false);
  // The step-view effect re-runs on React 19 dev StrictMode double-mount and
  // on back nav, Start Over and draft-recovery setState. PostHog dedupes
  // server-side but wizard_step_events does not, so without this guard one
  // step view writes several rows and understates funnel conversion. Same
  // ref-guard pattern as abandonedFiredRef and wizardCompletedRef below.
  const trackedStepsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    // Wait for the auth state before EITHER sink fires. Placed above the
    // PostHog capture too, not just the Supabase mirror: an early pass would
    // otherwise emit a step-view before posthog.register() has attached the
    // wizard_entry super-property, and would emit it twice.
    if (!entryResolved) {
      return;
    }
    captureTripWizardStepViewed({
      step_number: step,
      step_name: STEP_NAMES_CONST[step - 1],
    });
    // Mirror the step view into Supabase. Step 1 fires
    // `step_1_destination_dates`, step 2 fires `step_2_vibes`. This is the
    // entry-point event for each step — downstream events (generating/result/
    // save_clicked/saved/abandoned) are fired from their own handlers. Step 1
    // sends only `locale`, the one field guaranteed to be meaningful then.
    //
    // Gate on trackedStepsRef so we fire exactly once per step per wizard
    // mount lifetime: going back to a step (1→2→1) does not re-fire. A full
    // remount (route nav) resets the ref, which is correct — that's a new
    // session view.
    if (trackedStepsRef.current.has(step)) {
      return;
    }
    trackedStepsRef.current.add(step);
    if (step === 1) {
      void trackWizardEvent("step_1_destination_dates", { locale });
    } else if (step === 2) {
      void trackWizardEvent("step_2_vibes", {
        destination: destinationFieldRef.current || undefined,
        duration_days:
          startDateRef.current && endDateRef.current
            ? Math.max(
                1,
                Math.ceil(
                  (new Date(endDateRef.current).getTime() -
                    new Date(startDateRef.current).getTime()) /
                    (1000 * 60 * 60 * 24)
                ) + 1
              )
            : undefined,
        group_size: tripIntent,
        backpacker_mode: travelStyle === "backpacker",
        locale,
      });
    }
    // entryResolved is a REQUIRED dep: it flips false->true once the auth state
    // resolves and that flip is what actually fires the step view.
    // exhaustive-deps is disabled here, so the linter won't catch its removal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, entryResolved]);

  // ── Step-1 dwell heartbeat ───────────────────────────────────────────────
  // Many step-1 abandoners log a single event, so their dwell (bounce in <2s
  // vs deliberate struggle) is unmeasurable. A 10s heartbeat while the session
  // sits on step 1 turns them into a time series. Fire-and-forget via the
  // wizard-event sink; the 10s spacing never collides with the 1s dedupe
  // bucket (distinct rows = the dwell signal we want).
  //
  // Capped, because a backgrounded tab would otherwise beat every 10s for
  // hours and swamp wizard-event traffic: (1) skip the beat while the tab is
  // hidden — a backgrounded wizard is not "dwelling" — and (2) stop after 18
  // *visible* beats (~3 min). Past that it's a parked tab, not a struggling
  // user, so ">3 min" collapses into one bucket with no loss of signal.
  useEffect(() => {
    if (step !== 1) return;
    const MAX_BEATS = 18; // ~3 min of visible dwell, then the signal is saturated
    let beats = 0;
    const id = setInterval(() => {
      // A hidden/backgrounded tab is not deliberating — don't beacon, don't
      // count it. A user who tabs away and back still gets a truthful count.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void trackWizardEvent("step1_heartbeat", { locale });
      if (++beats >= MAX_BEATS) clearInterval(id);
    }, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Wizard funnel diagnostics ────────────────────────────────────────────
  // These refs + the abandonment listener record how far an abandoning
  // session got (no engagement at all, a destination typed but no dates,
  // etc.) to pinpoint which field on /trips/new loses the funnel.

  const wizardMountedAtRef = useRef<number>(Date.now());
  const stepStartedAtRef = useRef<number>(Date.now());
  const lastTouchedFieldRef = useRef<TripWizardFieldInteractedEvent["field"] | null>(null);
  const touchedFieldsThisStepRef = useRef<Set<string>>(new Set());
  const wizardCompletedRef = useRef<boolean>(false);
  const abandonedFiredRef = useRef<boolean>(false);
  // Synchronous re-entry guard for handleSaveTrip. setLoading(true) is async
  // — between click and re-render, a second click can fire before the button
  // is visibly disabled, producing duplicate trip rows. A ref check is
  // synchronous and catches the race regardless of React render timing.
  const savingTripRef = useRef<boolean>(false);

  // One-shot guard for the post-auth save-intent redemption (see the
  // effect just below handleSaveTrip). After a magic-link return we auto-
  // complete the Save the user already clicked before signing up. At most once.
  const saveIntentRedeemedRef = useRef<boolean>(false);

  // Has the user applied ≥1 anon-assistant edit? Mirrored to
  // sessionStorage ("mt_edits_applied") so the flag survives the post-auth
  // full-page round trip; the ref is the fast path + private-mode fallback.
  const editsAppliedRef = useRef<boolean>(false);
  // Assistant edits applied to the itinerary on screen (reset by every
  // generation). A full regenerate replaces them, so it asks first instead of
  // silently discarding them.
  const editsSinceGenerationRef = useRef<boolean>(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  // Changing the dates on the result, instead of starting over
  // (lib/trips/change-dates.ts). `datesNotice` reports a longer trip whose
  // extra days could not be planned.
  const [showChangeDates, setShowChangeDates] = useState(false);
  const [planningExtraDays, setPlanningExtraDays] = useState(false);
  const [datesNotice, setDatesNotice] = useState<string | null>(null);
  // Once-per-pagehide-sequence guard for result_exit_unsaved (reset on
  // pageshow when the page comes back out of the bfcache).
  const resultExitFiredRef = useRef<boolean>(false);

  // Mirror state into refs so the unload handlers can read current values
  // without having to re-bind the listeners on every state change.
  const stepRef = useRef(step);
  const destinationFieldRef = useRef(destination);
  const startDateRef = useRef(startDate);
  const endDateRef = useRef(endDate);
  const vibesRef = useRef(selectedVibes);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { destinationFieldRef.current = destination; }, [destination]);

  // Multi-city: mirror the route rows into `destination` (combined label) and
  // `endDate` (start + total nights) so step-1 validation, draft autosave, and
  // the result hero keep working through the existing single-city code paths.
  // Deep link: /trips/new?multi=1 (route-card CTAs on /multi-city-trip-planner
  // and the route blog posts) lands with multi-city mode pre-enabled.
  useEffect(() => {
    if (MULTI_CITY_ENABLED && searchParams?.get("multi") === "1") {
      setMultiCityMode(true);
      // Seed the first leg with the deeplinked city. Without this, a link like
      // ?destination=rome&multi=1 (the "5-day Italy itinerary" CTA) LOSES the
      // city: the mirror effect below rewrites `destination` from the route
      // rows, which are empty on arrival, so Rome is blanked a tick after it
      // was filled in. The article's city is leg one of the route, so putting
      // it there keeps it and is what the post actually describes.
      if (prefilledDestination) {
        setCityRows((rows) =>
          rows[0]?.city
            ? rows
            : [{ ...rows[0], city: prefilledDestination.name }, ...rows.slice(1)],
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!MULTI_CITY_ENABLED || !multiCityMode) return;
    const valid = cityRows.filter((r) => r.city.trim() && r.nights > 0);
    setDestination(joinCities(valid.map((r) => r.city.trim())));
    const total = valid.reduce((s, r) => s + r.nights, 0);
    if (startDate && total > 0) setEndDate(addDaysISO(startDate, total - 1));
  }, [multiCityMode, cityRows, startDate]);
  useEffect(() => { startDateRef.current = startDate; }, [startDate]);
  useEffect(() => { endDateRef.current = endDate; }, [endDate]);
  useEffect(() => { vibesRef.current = selectedVibes; }, [selectedVibes]);

  // Reset per-step tracking when the user advances/retreats
  useEffect(() => {
    stepStartedAtRef.current = Date.now();
    lastTouchedFieldRef.current = null;
    touchedFieldsThisStepRef.current = new Set();
  }, [step]);

  // Pre-fill destination from ?destination=<slug> deeplink (e.g. coming from
  // a /destinations/* page or a blog post CTA). Runs once on mount; if the
  // user already started typing/restored a draft we don't clobber that.
  // page.tsx resolves the slug server-side: a known destination arrives as
  // `prefilledDestination`; otherwise the raw `?destination=` value is used as
  // free text (capitalized, coords filled in by autocomplete on confirm).
  useEffect(() => {
    if (destinationFieldRef.current) return;

    if (prefilledDestination) {
      setDestination(prefilledDestination.name);
      setDestinationCoords({
        latitude: prefilledDestination.latitude,
        longitude: prefilledDestination.longitude,
      });
      return;
    }

    const param = searchParams?.get("destination");
    if (!param) return;
    // Free-text fallback — capitalize but otherwise pass through.
    const trimmed = param.trim().slice(0, 120);
    if (trimmed) {
      setDestination(trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill the SHAPE of the trip (length, budget, vibes) from a blog CTA, so
  // a reader arriving from "3-day Paris itinerary" doesn't have to retype the
  // trip the article described. The params are derived from what the post
  // itself declares (lib/blog/trip-prefill.ts) and validated in page.tsx, so by
  // the time they get here they are already known-good or absent.
  //
  // Runs once on mount and only on a truly untouched wizard. Draft recovery
  // runs later and overwrites this on purpose — a trip the reader actually
  // started outranks a query string they never typed.
  useEffect(() => {
    if (!prefilledTripShape) return;
    if (destinationFieldRef.current) return;
    const { days, budget, vibes } = prefilledTripShape;
    if (!days && !budget && vibes.length === 0) return;

    if (budget) setBudgetTier(budget);
    if (vibes.length > 0) setSelectedVibes(vibes as TripVibe[]);

    // Dates: the wizard gates step 1 on a real start+end, and `days` alone
    // can't produce one. Resolve it exactly the way the "I'm flexible" button
    // does — start ~3 weeks out, span the article's length — and set the same
    // flexibleDates flag, so the UI openly shows the dates are a placeholder
    // rather than something the reader chose.
    //
    // Never in multi-city mode: there the end date is recomputed from the sum
    // of per-city nights, so a span set here would be overwritten anyway, and a
    // long single-city span heading into a one-city route is the documented way
    // to earn a 400 from the generate call.
    const isMultiDeeplink = MULTI_CITY_ENABLED && searchParams?.get("multi") === "1";
    if (days && !isMultiDeeplink) {
      const today = new Date().toISOString().split("T")[0];
      const start = addDaysISO(today, 21);
      setStartDate(start);
      setEndDate(addDaysISO(start, days - 1));
      setFlexibleDates(true);
    }

    posthog.capture("wizard_prefilled_from_article", {
      prefilled_days: days ?? null,
      prefilled_budget: budget ?? null,
      prefilled_vibes: vibes,
      has_destination: Boolean(prefilledDestination || searchParams?.get("destination")),
      multi_city: Boolean(isMultiDeeplink),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Record a field interaction. Emits trip_wizard_field_interacted on first
   * touch only (don't flood PostHog) and updates the last-touched ref so
   * the abandonment event can name the field they bailed on.
   */
  const trackFieldInteraction = useCallback(
    (field: TripWizardFieldInteractedEvent["field"]) => {
      lastTouchedFieldRef.current = field;
      const firstTouch = !touchedFieldsThisStepRef.current.has(field);
      if (firstTouch) {
        touchedFieldsThisStepRef.current.add(field);
        captureTripWizardFieldInteracted({
          step_number: stepRef.current,
          step_name: STEP_NAMES_CONST[stepRef.current - 1],
          field,
          first_touch: true,
        });
      }
    },
    [STEP_NAMES_CONST]
  );

  // Memoized VibeSelector handler so the child's React.memo can short-circuit;
  // a new function identity on every parent render would bust memoization and
  // make step 2 expensive to re-render.
  const handleVibesChange = useCallback(
    (v: TripVibe[]) => {
      trackFieldInteraction("vibe");
      setSelectedVibes(v);
    },
    [trackFieldInteraction]
  );

  // Abandonment listener: fire trip_wizard_abandoned exactly once when the
  // user closes the tab, navigates away, or the wizard component unmounts —
  // unless they completed the flow (wizardCompletedRef set in handleGenerate).
  useEffect(() => {
    function fireAbandoned() {
      if (abandonedFiredRef.current || wizardCompletedRef.current) return;
      // Only fire if they actually engaged (touched ≥ 1 field). Otherwise
      // we'd flood PostHog with bot/preview pageviews.
      if (touchedFieldsThisStepRef.current.size === 0 && stepRef.current === 1) {
        return;
      }
      abandonedFiredRef.current = true;
      const totalSeconds = Math.round((Date.now() - wizardMountedAtRef.current) / 1000);
      captureTripWizardAbandoned({
        last_step_completed: Math.max(0, stepRef.current - 1),
        last_step_name: STEP_NAMES_CONST[stepRef.current - 1],
        total_time_seconds: totalSeconds,
        last_touched_field: lastTouchedFieldRef.current,
        had_destination: Boolean(destinationFieldRef.current),
        had_dates: Boolean(startDateRef.current && endDateRef.current),
        had_vibes: vibesRef.current.length > 0,
      });
      // Supabase funnel mirror — terminal `abandoned` state. We use
      // the same step-name vocabulary as the other wizard events so
      // SQL funnel queries can self-join the table on
      // (session_id, step) without name translation.
      // keepalive=true on the fetch is what makes this survive the
      // beforeunload / pagehide path on most browsers.
      const lastStepName: WizardEventStep =
        stepRef.current === 1
          ? "step_1_destination_dates"
          : "step_2_vibes";
      void trackWizardEvent("abandoned", {
        destination: destinationFieldRef.current || undefined,
        duration_days:
          startDateRef.current && endDateRef.current
            ? Math.max(
                1,
                Math.ceil(
                  (new Date(endDateRef.current).getTime() -
                    new Date(startDateRef.current).getTime()) /
                    (1000 * 60 * 60 * 24)
                ) + 1
              )
            : undefined,
        locale,
        // Surface the last in-wizard step the user reached, plus the
        // last field they touched, so we can answer "which field did
        // people quit on?" in SQL the same way we already can in
        // PostHog.
        last_step: lastStepName,
        last_touched_field: lastTouchedFieldRef.current ?? undefined,
        total_time_seconds: totalSeconds,
      });
    }

    function handleVisibility() {
      if (document.visibilityState === "hidden") fireAbandoned();
    }

    window.addEventListener("beforeunload", fireAbandoned);
    window.addEventListener("pagehide", fireAbandoned);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      // Fire on SPA unmount too (router.push elsewhere mid-wizard)
      fireAbandoned();
      window.removeEventListener("beforeunload", fireAbandoned);
      window.removeEventListener("pagehide", fireAbandoned);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [STEP_NAMES_CONST]);

  // Existing-trips check. Auth state itself flows from the central
  // AuthProvider above; this effect only fetches the trips count, which gets
  // re-evaluated whenever the user resolves or changes.
  useEffect(() => {
    if (authLoading) return;
    if (!authUser) {
      setHasExistingTrips(false);
      return;
    }
    const checkExistingTrips = async () => {
      const supabase = createClient();
      const { count } = await supabase
        .from("trips")
        .select("*", { count: "exact", head: true })
        .eq("user_id", authUser.id);
      setHasExistingTrips((count ?? 0) > 0);
    };
    checkExistingTrips();
  }, [authLoading, authUser]);

  // Handle pending generation after signup (when draft is restored).
  // The `pendingTripGeneration` flag lives in `prefs` because plain
  // localStorage gets evicted on iOS WebView under ITP / storage pressure.
  // The read is async, so we wrap it in an inner fn and gate the side
  // effect on the still-current cleanup state.
  useEffect(() => {
    // Only run if authenticated AND draft has been auto-restored
    if (!isAuthenticated || !draftAutoRestored) return;
    if (!destination || !startDate || !endDate || selectedVibes.length === 0) return;
    if (generating || generatedItinerary) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      const pending = await prefs.get("pendingTripGeneration");
      if (cancelled || pending !== "true") return;
      await prefs.remove("pendingTripGeneration");
      // Small delay to ensure UI is ready and React state has propagated
      timer = setTimeout(() => {
        if (!cancelled) handleGenerate();
      }, 500);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, draftAutoRestored, destination, startDate, endDate, selectedVibes, generating, generatedItinerary]);

  // Scroll to top when step changes to prevent "already scrolled" issue
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

  // Scroll to top when itinerary is generated
  useEffect(() => {
    if (generatedItinerary) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [generatedItinerary]);

  // Build seasonal context when destination and dates are set.
  // Uses latitude for accurate (Southern Hemisphere) season detection.
  //
  // The build is deferred into a microtask: seasonal context only feeds
  // non-critical UI (the post-dates SeasonalContextCard + the vibe-suggestion
  // seed on Continue), so it must never block an interaction frame, even if
  // the lib grows (e.g. fetched holidays, weather lookup).
  useEffect(() => {
    if (!destination || !startDate) {
      setSeasonalContext(null);
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const context = buildSeasonalContext(
        destination,
        startDate,
        destinationCoords?.latitude, // Pass latitude for correct hemisphere
        endDate || undefined // Pass endDate so holidays outside the window drop
      );
      if (!cancelled) setSeasonalContext(context);
    });
    return () => {
      cancelled = true;
    };
  }, [destination, startDate, endDate, destinationCoords]);

  // Is the draft's itinerary already one of this user's trips? Asked once per
  // draft, only while it could still be restored (signed in, nothing on
  // screen yet). decideDraftRestore waits for the answer and discards a draft
  // that is already saved instead of restoring it into a second insert.
  const draftCheckKey =
    isAuthenticated === true && authUser && draft?.generatedItinerary && !generatedItinerary && !draftAutoRestored
      ? `${authUser.id}:${draft.savedAt}`
      : null;
  const [draftSavedCheck, setDraftSavedCheck] = useState<{ key: string; saved: boolean } | null>(null);
  useEffect(() => {
    if (!draftCheckKey || !authUser || !draft?.generatedItinerary) return;
    let alive = true;
    void isItinerarySaved(createClient(), authUser.id, draft.generatedItinerary).then((saved) => {
      if (alive) setDraftSavedCheck({ key: draftCheckKey, saved });
    });
    return () => {
      alive = false;
    };
  }, [draftCheckKey, authUser, draft]);
  const draftIsSavedTrip =
    draftSavedCheck && draftSavedCheck.key === draftCheckKey ? draftSavedCheck.saved : null;

  // Check for unsaved draft on mount - AUTO-RESTORE it for a signed-in user.
  // The `pendingTripGeneration` flag lives in `prefs` (async on native
  // Capacitor) — wrap the read in an inner async fn and use `cancelled`
  // so we don't set state after unmount / dep change.
  useEffect(() => {
    if (!hasDraft || !draft || generatedItinerary || draftAutoRestored) return;
    // Auth is tri-state and is null on every first render. Returning here
    // rather than falling through is what makes the rest of this effect work:
    // isAuthenticated is in the dep array, so this re-runs the moment auth
    // resolves. Without the early return the first pass would latch
    // showDraftRecovery for a user who IS signed in, and the auto-restore
    // below would never get a turn.
    if (isAuthenticated === null) return;

    let cancelled = false;

    (async () => {
      // Check if we're coming back from auth with pending generation
      const hasPendingGeneration = (await prefs.get("pendingTripGeneration")) === "true";
      if (cancelled) return;

      // Decision in lib/wizard/draft-restore.ts, with the tri-state auth trap
      // pinned by unit tests. Restores for ANYONE signed in holding an unsaved
      // itinerary, not only the Save-modal path: `pendingTripGeneration` is
      // only written inside AuthPromptModal, so a planner who signed in through
      // the header, the login page or a magic link would otherwise come back
      // to a blank wizard with their itinerary unread in localStorage.
      const decision = decideDraftRestore({
        hasDraft,
        hasItineraryInDraft: !!draft.generatedItinerary,
        alreadyRestored: draftAutoRestored,
        itineraryOnScreen: !!generatedItinerary,
        isAuthenticated,
        savedTripId,
        pendingTripGeneration: hasPendingGeneration,
        draftIsSavedTrip,
      });

      if (decision === "discard") {
        // Already one of their trips: restoring it would insert it again.
        clearDraft();
        return;
      }
      if (decision === "auto-restore") {
        // Auto-restore the draft silently (no banner) for seamless post-auth experience.
        // Restore the itinerary too, not just the form: with no itinerary on
        // screen the pending-generation effect above re-runs handleGenerate()
        // and silently replaces the itinerary the user clicked Save on.
        setDestination(draft.destination);
        setStartDate(draft.startDate);
        setEndDate(draft.endDate);
        setPace(draft.pace as "relaxed" | "moderate" | "active");
        setSelectedVibes(draft.vibes as TripVibe[]);
        setBudgetTier(draft.budgetTier as "budget" | "balanced" | "premium");
        if (Array.isArray(draft.mustDos)) setMustDos(draft.mustDos as string[]);
        // travelStyle may be missing from a stored draft → stays "classic"
        if (draft.travelStyle === "backpacker") {
          setTravelStyle("backpacker");
        }
        if (draft.anchors && draft.anchors.length > 0) {
          setAnchors(draft.anchors);
        }
        // Restore the "Who's coming?" answer. When a stored draft lacks it,
        // the wizard keeps its "unspecified" default.
        if (draft.tripIntent === "solo" || draft.tripIntent === "group") {
          setTripIntent(draft.tripIntent);
        }
        if (draft.generatedItinerary) {
          setGeneratedItinerary(draft.generatedItinerary);
          // The restored trip becomes the session stack's current entry
          // (adopting a pre-auth entry from this same tab when one matches,
          // so the OAuth round trip doesn't duplicate a chip).
          registerSessionRestore({
            destination: draft.destination,
            startDate: draft.startDate,
            endDate: draft.endDate,
            dayCount: draft.generatedItinerary.days.length,
            itinerary: draft.generatedItinerary,
            pace: draft.pace,
            vibes: draft.vibes,
            budgetTier: draft.budgetTier,
            travelStyle: draft.travelStyle === "backpacker" ? "backpacker" : "classic",
          });
        }
        // Don't restore coordinates - they'll be re-fetched if needed
        setDraftAutoRestored(true);
        // Don't show the banner since we're auto-restoring — and close it if a
        // pass before auth resolved had already opened it.
        setShowDraftRecovery(false);
        void trackWizardEvent("draft_restored", {
          destination: draft.destination,
          duration_days: draft.generatedItinerary?.days.length,
          locale,
        });
      } else if (decision === "offer-banner") {
        // Signed out: let them choose rather than restoring under them.
        setShowDraftRecovery(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasDraft, draft, generatedItinerary, draftAutoRestored, registerSessionRestore, isAuthenticated, savedTripId, locale, draftIsSavedTrip, clearDraft]);

  // Keep a draft of the itinerary until the trip is saved, then none.
  //
  // Once the trip exists, the row is the copy that survives: the auto-save arm
  // UPDATEs it on every edit. A draft written after that has no link to the
  // row, so a later visit to the wizard would auto-restore it and the
  // auto-save arm would insert it as a second trip. So a saved trip clears the
  // draft instead.
  useEffect(() => {
    if (!generatedItinerary) return;
    if (savedTripId) {
      clearDraft();
      return;
    }
    saveDraft({
      generatedItinerary,
      destination,
      startDate,
      endDate,
      pace,
      vibes: selectedVibes,
      budgetTier,
      travelStyle,
      anchors,
      mustDos,
      tripIntent,
    });
    // tripIntent belongs here: without it the effect doesn't re-run when the
    // user changes "Who's coming?" after generating, and the draft keeps the
    // stale answer — which would quietly corrupt the very measurement this
    // field exists to produce. Same for mustDos.
  }, [generatedItinerary, destination, startDate, endDate, pace, selectedVibes, budgetTier, travelStyle, anchors, mustDos, tripIntent, saveDraft, savedTripId, clearDraft]);

  // ── Auto-save trip orchestration ────
  // The hook owns the save state machine: INSERT-or-UPDATE, the in-flight save
  // (so regenerate can await it), errors and discard (hooks/useAutoSaveTrip.ts).
  // Always on, unless NEXT_PUBLIC_AUTO_SAVE_FORCE=off (lib/trips/autoSaveGate.ts);
  // then the redemption effect below owns the post-auth save instead.
  const autoSaveEnabled = shouldAutoSave(process.env.NEXT_PUBLIC_AUTO_SAVE_FORCE);

  const autoSaveFormState: PersistTripFormState = {
    destination,
    startDate,
    endDate,
    budgetTier,
    pace,
    vibes: selectedVibes,
    derivedInterests: deriveInterestsFromVibes(),
    travelStyle,
    // Fallback for trip_meta.locale; the itinerary's own language wins.
    locale,
    anchors,
    mustDos,
    // "Who's coming?" is written to the trip so the answer is queryable from
    // the database (reading it from PostHog needs a personal API key). That
    // is what makes the toggle evidence for the group-vs-solo decision.
    tripIntent,
  };

  // One id per wizard MOUNT, written into every trip this mount inserts, so a
  // duplicate insert can be diagnosed: different mount ids mean a remount
  // (reload/second tab, where a fresh insert is correct); the same mount id
  // means the saved-trip ref was lost inside one mount (a real bug).
  //
  // useRef, not useState: it must never trigger a render, and it must survive
  // every re-render of this very large component without changing.
  const wizardMountIdRef = useRef<string | null>(null);
  if (wizardMountIdRef.current === null && typeof window !== "undefined") {
    wizardMountIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        // Older Safari has crypto but not randomUUID. A collision here costs a
        // slightly ambiguous diagnostic, nothing user-facing, so a cheap
        // fallback beats pulling in a dependency.
        : `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  const autoSaveTrip = useCallback(async (input: PersistInput) => {
    const supabase = createClient();
    // Local session read, not a network getUser(): the RPC enforces
    // auth.uid() under RLS regardless, and a network pre-check would turn any
    // auth hiccup into a hard failure of the save that nobody could see. The
    // error names its cause so Sentry can group it.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) throw new Error("auto-save: no client session");
    return persistInsertTrip(supabase, input, session.user.id, {
      arm: "auto",
      mountId: wizardMountIdRef.current,
    });
  }, []);

  const autoUpdateTrip = useCallback(async (tripId: string, input: PersistInput) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    return persistUpdateTrip(supabase, tripId, input, user.id);
  }, []);

  const autoDeleteTrip = useCallback(async (tripId: string) => {
    const supabase = createClient();
    return persistDeleteTrip(supabase, tripId);
  }, []);

  const autoAttachCoverImage = useCallback(async (tripId: string, dest: string) => {
    const supabase = createClient();
    return persistAttachCoverImage(supabase, tripId, dest);
  }, []);

  const handlePersisted = useCallback(
    (tripId: string, durationDays: number, mode: "insert" | "update") => {
      if (mode === "insert") {
        // GA4 + referral + bananas + side-effects (mirrors the manual
        // handleSaveTrip post-insert block).
        //
        // On the login-return remount this insert block can run several times
        // for ONE trip (the row is reused by the 60s dedup, but the analytics
        // would fire every time). Gate the WHOLE emit group on the durable,
        // trip-id-keyed guard so each event fires exactly once per trip. It
        // does not gate clearDraft / setSavedTripId below, which must still run.
        if (claimTripCreatedEmit(tripId)) {
          trackTripCreated({
            tripId,
            destination,
            duration: durationDays,
            budgetTier,
            isFromTemplate: false,
          });
          // Supabase funnel mirror — `saved` terminal state for the
          // auto-save path. Only on insert (first save), so we don't
          // double-count regenerates as separate funnel completions.
          void trackWizardEvent("saved", {
            destination,
            duration_days: durationDays,
            group_size: tripIntent,
            backpacker_mode: travelStyle === "backpacker",
            locale,
          });
          // Fire first_trip_saved for organic and referred users alike, as
          // the manual handleSaveTrip path does. Both save paths emit the
          // event so cohort math works regardless of which flow the user
          // falls through.
          try {
            captureFirstTripSaved({
              trip_id: tripId,
              destination,
              duration_days: durationDays,
              time_to_value_minutes: 0,
              from_template: false,
              is_anchored: anchors.length > 0,
              anchor_count: anchors.length,
            });
          } catch (e) {
            console.error("[Auto-save] first_trip_saved error:", e);
          }
          handleTripCreatedWithReferral(
            tripId,
            destination,
            durationDays,
            budgetTier,
            false,
          ).catch((err) => {
            console.error("[Auto-save] referral/tracking error:", err);
          });
        }
        clearDraft();
        if (typeof window !== "undefined") {
          safeSet("profile_modal_shown", "true", "session");
        }
        // Set savedTripId directly so the sticky bar and the post-save
        // redirects have it immediately (the mirror effect below also sets it).
        setSavedTripId(tripId);
        // No share ask here: at insert time the user hasn't read the
        // itinerary they'd be asked to send. It lives on /trips/[id] behind an
        // engagement gate; see components/trip/SharePromptOnTrip.tsx.
      } else {
        // Don't re-fire referral/bananas on regen — only count the
        // first save. Just emit the distinct trip_updated event for
        // funnel analysis.
        captureTripUpdated({
          trip_id: tripId,
          destination,
          duration_days: durationDays,
          budget_tier: budgetTier,
          is_from_template: false,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destination, budgetTier, clearDraft],
  );

  // Auto-save observability: every failure and every skip leaves an event, so
  // a lost generation is never silent. Sentry is unconditional (no consent
  // gate), the server row is consent-free, PostHog is the sliceable mirror.
  // Same error bucketing as the manual Save path so dashboards chart both
  // arms together.
  const reportAutoSaveFailure = (err: Error, info: { attempts: number }) => {
    const errMsg = err.message ?? "";
    const errorClass: "network" | "rls" | "validation" | "rate_limit" | "unknown" =
      /network|fetch|ECONN|timeout|no client session/i.test(errMsg)
        ? "network"
        : /rls|row-level|policy|permission|authenticated caller/i.test(errMsg)
          ? "rls"
          : /rate.?limit|429/i.test(errMsg)
            ? "rate_limit"
            : /invalid|required|missing|validation/i.test(errMsg)
              ? "validation"
              : "unknown";
    Sentry.withScope((scope) => {
      scope.setTag("feature", "auto_save");
      scope.setTag("arm", "auto");
      scope.setTag("error_class", errorClass);
      scope.setExtra("attempts", info.attempts);
      scope.setExtra("destination", destination);
      Sentry.captureException(err);
    });
    void trackWizardEvent(
      "save_failed",
      { destination, group_size: tripIntent, backpacker_mode: travelStyle === "backpacker", locale }
    );
    void captureSaveFailed({
      destination,
      group_size: tripIntent,
      backpacker_mode: travelStyle === "backpacker",
      error_class: errorClass,
      error_message: errMsg.slice(0, 80) || undefined,
      arm: "auto",
      attempts: info.attempts,
    });
    console.error(`[auto-save] failed after ${info.attempts} attempt(s):`, err);
  };
  const reportAutoSaveSkipped = (reason: AutoSaveSkipReason) => {
    void captureAutoSaveSkipped({ reason, destination });
  };

  // -- Pending anonymous share ----------------------------------------------
  // A signed-out planner who shared this itinerary minted an ownerless trip
  // row, and this browser holds its claim token. On sign-in TWO things would
  // persist the same itinerary: AuthProvider claims that row, and the
  // auto-save hook inserts a fresh one; the keep-it nudge on the share row
  // makes that collision routine.
  // Rule (lib/trips/pending-claim.ts): while the draft on screen matches the
  // shared trip and the claim is unresolved, auto-save waits; a claimed id is
  // adopted as THE saved trip; a released claim (expired, taken, no token)
  // hands persistence back to auto-save.
  const [pendingClaim, setPendingClaim] = useState<PendingClaim | null>(null);
  const [claimResolution, setClaimResolution] = useState<ClaimResolution>("none");
  const [adoptedTripId, setAdoptedTripId] = useState<string | null>(null);
  const [pendingClaimDismissed, setPendingClaimDismissed] = useState(false);
  // A share link minted in THIS session, shared by every AnonymousShareButton
  // on screen so only one ownerless trip is ever created.
  const [sessionShareUrl, setSessionShareUrl] = useState<string | null>(null);
  const [authPromptLocation, setAuthPromptLocation] = useState<AuthPromptLocation>("wizard_save");
  // Save (default) or the anonymous free-generation cap: same sign-up, the
  // modal words it for why we're asking.
  const [authPromptReason, setAuthPromptReason] = useState<"save" | "generation_limit">("save");
  // After signing up at the cap, come back to the wizard with the destination
  // filled in (the ?destination= deep link). Save keeps the modal's default.
  const limitRedirectPath =
    authPromptReason === "generation_limit" && destination
      ? `/trips/new?destination=${encodeURIComponent(destination)}`
      : undefined;
  useEffect(() => {
    let alive = true;
    void readPendingClaim().then((p) => {
      if (!alive || !p) return;
      setPendingClaim(p);
      setClaimResolution("unresolved");
    });
    return () => {
      alive = false;
    };
  }, []);
  const pendingMatchesDraft = pendingClaimMatchesDraft(pendingClaim, { destination, startDate, endDate });
  const deferAutoSave = shouldDeferAutoSave({ matches: pendingMatchesDraft, resolution: claimResolution });
  const adoptClaimedTrip = useCallback((id: string) => {
    setAdoptedTripId(id);
    setSavedTripId(id);
    setClaimedTripId(id);
    setClaimResolution("adopted");
    setPendingClaim(null);
  }, []);
  // The claim can complete on either side (AuthProvider publishes the signal;
  // the wizard asks directly below). Whichever reports first wins.
  useEffect(() => {
    if (claimResolution !== "unresolved" || !pendingClaim || !pendingMatchesDraft) return;
    if (claimedTripId === pendingClaim.tripId) adoptClaimedTrip(claimedTripId);
  }, [claimedTripId, pendingClaim, pendingMatchesDraft, claimResolution, adoptClaimedTrip]);
  useEffect(() => {
    if (claimResolution !== "unresolved" || !pendingClaim || !pendingMatchesDraft || isAuthenticated !== true) return;
    let alive = true;
    const tripId = pendingClaim.tripId;
    if (readClaimedTrip() === tripId) {
      adoptClaimedTrip(tripId);
      return;
    }
    void import("@/lib/trips/anonymous-claim-client")
      .then(({ claimPendingTrip }) => claimPendingTrip())
      .then((id) => {
        if (!alive) return;
        if (id) adoptClaimedTrip(id);
        else if (readClaimedTrip() === tripId) adoptClaimedTrip(tripId);
        else {
          setClaimResolution("released");
          setPendingClaim(null);
        }
      })
      .catch(() => {
        if (!alive) return;
        setClaimResolution("released");
        setPendingClaim(null);
      });
    return () => {
      alive = false;
    };
  }, [claimResolution, pendingClaim, pendingMatchesDraft, isAuthenticated, adoptClaimedTrip]);
  const handleAnonShared = (pending: PendingClaim) => {
    // Every share button on screen adopts this one link. Minting twice would
    // create a second ownerless trip whose claim token the browser has
    // already overwritten, stranding the first and inflating the
    // anonymous-share counts the /admin panel reads.
    setSessionShareUrl(pending.shareUrl);
    setPendingClaim(pending);
    setClaimResolution("unresolved");
    setPendingClaimDismissed(false);
  };
  // The same door the Save button opens for a signed-out planner, with the
  // draft parked first so the itinerary is on screen again after the auth
  // round-trip.
  const openKeepAuth = (location: AuthPromptLocation) => {
    if (generatedItinerary) {
      saveDraft({
        generatedItinerary,
        destination,
        startDate,
        endDate,
        pace,
        vibes: selectedVibes,
        budgetTier,
        travelStyle,
        mustDos,
        anchors,
        tripIntent,
      });
    }
    setAuthPromptLocation(location);
    setAuthPromptReason("save");
    setShowAuthModal(true);
  };
  const handleKeepSharedTrip = () => {
    void trackWizardEvent("save_clicked", {
      destination,
      group_size: tripIntent,
      backpacker_mode: travelStyle === "backpacker",
      locale,
    });
    // Every call site of this handler is gated on isAuthenticated === false,
    // so a Keep tap here is the auth wall by definition — the same terminal
    // event handleSaveTrip fires when it bounces an anon saver. Without it
    // this path would emit save_clicked with no outcome, and the funnel
    // accounting (save_clicked minus saved/blocked/failed) reads that silence
    // as a React crash mid-save.
    void trackWizardEvent("save_blocked_anon", {
      destination,
      group_size: tripIntent,
      backpacker_mode: travelStyle === "backpacker",
      locale,
    });
    // PostHog mirror, sync/nav-safe, for the same reason as the main path:
    // the auth modal opens immediately after and an async capture loses the race.
    captureSaveBlockedAnon({
      destination,
      group_size: tripIntent,
      backpacker_mode: travelStyle === "backpacker",
      modal_shown: true,
    });
    openKeepAuth("anon_share_keep");
  };
  const showPendingClaimBanner =
    isAuthenticated === false && !!pendingClaim && !pendingClaimDismissed && !generatedItinerary && step === 1;
  const pendingSurfacedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showPendingClaimBanner || !pendingClaim || pendingSurfacedRef.current === pendingClaim.tripId) return;
    pendingSurfacedRef.current = pendingClaim.tripId;
    void capturePendingClaimBanner({ action: "surfaced", destination: pendingClaim.destination, trip_id: pendingClaim.tripId });
  }, [showPendingClaimBanner, pendingClaim]);
  const handlePendingClaimAction = (action: "keep" | "open_link" | "dismissed") => {
    void capturePendingClaimBanner({ action, destination: pendingClaim?.destination, trip_id: pendingClaim?.tripId });
    if (action === "keep") openKeepAuth("pending_claim");
    if (action === "dismissed") setPendingClaimDismissed(true);
  };
  const autoSave = useAutoSaveTrip({
    itinerary: generatedItinerary,
    isAuthenticated,
    enabled: autoSaveEnabled,
    deferred: deferAutoSave,
    adoptedTripId,
    formState: autoSaveFormState,
    saveTrip: autoSaveTrip,
    updateTrip: autoUpdateTrip,
    deleteTrip: autoDeleteTrip,
    attachCoverImage: autoAttachCoverImage,
    onPersisted: handlePersisted,
    onError: reportAutoSaveFailure,
    onSkipped: reportAutoSaveSkipped,
  });

  // Mirror the auto-save trip id into the existing savedTripId state so the
  // Sticky Bottom Bar and the post-save redirects read it from one place.
  // setState is a no-op when values are equal.
  useEffect(() => {
    if (autoSave.savedTripId && autoSave.savedTripId !== savedTripId) {
      setSavedTripId(autoSave.savedTripId);
    }
    if (!autoSave.savedTripId && savedTripId && autoSaveEnabled) {
      // discarded
      setSavedTripId(null);
    }
  }, [autoSave.savedTripId, savedTripId, autoSaveEnabled]);

  // ── Unsaved-state derivation + nudge/exit instrumentation ────────────────
  // "Unsaved" respects BOTH save arms: the manual flow (savedTripId) and the
  // auto-save flow (autoSave.savedTripId).
  const isUnsaved = !savedTripId && !autoSave.savedTripId;
  const hasResult = Boolean(generatedItinerary);
  // The tray's restore-swap must never run while the auto-save arm is live:
  // useAutoSaveTrip's effect would UPDATE the persisted row with a DIFFERENT
  // trip's content on swap (verified in hooks/useAutoSaveTrip.ts persist()).
  // isAuthenticated === true matters — null is still-loading, and the
  // auto-save effect no-ops until auth resolves truthy anyway.
  const autoSaveArmActive = autoSaveEnabled && isAuthenticated === true;
  const sessionTrayVisible =
    hasResult && isUnsaved && !autoSaveArmActive && sessionTrips.length >= 2;

  // save_nudge_shown for the "Not saved" pill — once per session
  // (sessionStorage once-flag; desktop + mobile pills share this one effect).
  useEffect(() => {
    if (!hasResult || !isUnsaved) return;
    if (safeGet("mt_save_nudge_pill_captured", "session") === "1") return;
    // A blocked store cannot dedupe, and safeSet reports that instead of
    // throwing. Skip rather than spam this once-per-session event on every
    // remount.
    if (!safeSet("mt_save_nudge_pill_captured", "1", "session")) return;
    void capture("save_nudge_shown", {
      source: "unsaved_pill",
      gen_count: getGenCount(),
    });
  }, [hasResult, isUnsaved, getGenCount]);

  // save_nudge_shown for the session tray — once per session.
  useEffect(() => {
    if (!sessionTrayVisible) return;
    if (safeGet("mt_save_nudge_tray_captured", "session") === "1") return;
    // Same as the pill above: no store means no dedupe, so stay quiet.
    if (!safeSet("mt_save_nudge_tray_captured", "1", "session")) return;
    void capture("save_nudge_shown", {
      source: "session_tray",
      gen_count: getGenCount(),
    });
  }, [sessionTrayVisible, getGenCount]);

  // Native leave-guard, SEPARATE from the fireAbandoned analytics listener
  // above. While an UNSAVED result is on screen, tab-close/back/external nav
  // triggers the browser's native "leave site?" dialog. Disarmed when saved
  // (either arm), while the auth modal is open (the Google OAuth full-page
  // redirect starts from inside it and must not be interrupted), and inside
  // the Capacitor shell (beforeunload dialogs are broken in WebViews). SPA
  // navigations never fire beforeunload, so in-app moves are unaffected.
  useEffect(() => {
    if (!hasResult || !isUnsaved || showAuthModal) return;
    if (isCapacitorNative()) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasResult, isUnsaved, showAuthModal]);

  // Exit telemetry. pagehide with an unsaved result → nav-safe
  // result_exit_unsaved (sync SDK queue + sendBeacon flush — the same
  // mechanism as captureSaveBlockedAnon). At most once per pagehide sequence
  // (ref guard, reset when the page returns from the bfcache) and never
  // after save: the effect tears down as soon as isUnsaved flips false.
  useEffect(() => {
    if (!hasResult || !isUnsaved) return;
    const onPageHide = () => {
      if (resultExitFiredRef.current) return;
      resultExitFiredRef.current = true;
      let editsApplied = editsAppliedRef.current;
      if (!editsApplied) {
        // safeGet reports a blocked store as null rather than throwing, and
        // null is the same answer the ref already gave us.
        editsApplied = safeGet("mt_edits_applied", "session") === "1";
      }
      captureResultExitUnsaved({
        gen_count: getGenCount(),
        edits_applied: editsApplied,
      });
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) resultExitFiredRef.current = false;
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [hasResult, isUnsaved, getGenCount]);

  // Handle draft restoration
  const handleRestoreDraft = () => {
    if (draft) {
      setDestination(draft.destination);
      setStartDate(draft.startDate);
      setEndDate(draft.endDate);
      setPace(draft.pace as "relaxed" | "moderate" | "active");
      setSelectedVibes(draft.vibes as TripVibe[]);
      setBudgetTier(draft.budgetTier as "budget" | "balanced" | "premium");
      if (Array.isArray(draft.mustDos)) setMustDos(draft.mustDos as string[]);
      if (draft.travelStyle === "backpacker") {
        setTravelStyle("backpacker");
      }
      if (draft.tripIntent === "solo" || draft.tripIntent === "group") {
        setTripIntent(draft.tripIntent);
      }
      setGeneratedItinerary(draft.generatedItinerary);
      // Mirror the restore into the session stack so the
      // banner-restored trip is durable in the tray (and not re-pushed as a
      // duplicate if it already came from this session).
      if (draft.generatedItinerary) {
        registerSessionRestore({
          destination: draft.destination,
          startDate: draft.startDate,
          endDate: draft.endDate,
          dayCount: draft.generatedItinerary.days.length,
          itinerary: draft.generatedItinerary,
          pace: draft.pace,
          vibes: draft.vibes,
          budgetTier: draft.budgetTier,
          travelStyle: draft.travelStyle === "backpacker" ? "backpacker" : "classic",
        });
      }
      setShowDraftRecovery(false);
      void trackWizardEvent("draft_restored", {
        destination: draft.destination,
        duration_days: draft.generatedItinerary?.days.length,
        locale,
      });
    }
  };

  // An expired draft is reported once per mount. useItineraryDraft has already
  // deleted it by the time this flag is readable, so this row is the only
  // record that a plan was lost to the TTL rather than abandoned.
  const draftExpiredReportedRef = useRef(false);
  useEffect(() => {
    if (!isExpired || draftExpiredReportedRef.current) return;
    draftExpiredReportedRef.current = true;
    void trackWizardEvent("draft_expired", { locale });
  }, [isExpired, locale]);

  // Handle draft discard
  const handleDiscardDraft = () => {
    clearDraft();
    setShowDraftRecovery(false);
  };

  // Regenerate, asking first when the assistant has changed this itinerary.
  const requestRegenerate = () => {
    if (editsSinceGenerationRef.current) {
      setConfirmRegenerate(true);
      return;
    }
    void handleRegenerate();
  };

  // Regenerate itinerary with same preferences
  const handleRegenerate = async () => {
    if (isRegenerating || generating) return;

    setIsRegenerating(true);
    // CRITICAL: await any in-flight auto-save BEFORE we tear down state.
    // Otherwise the next persist sees savedTripId still null and emits a
    // duplicate INSERT — silent data loss for the original trip.
    if (autoSaveEnabled) {
      await autoSave.regenerate();
    }
    setGeneratedItinerary(null); // Clear current to show progress

    // Small delay for visual feedback
    await new Promise(resolve => setTimeout(resolve, 100));

    // Re-trigger generation: a DIFFERENT version, so skip the shared cache.
    await handleGenerate({ fresh: true });
    setIsRegenerating(false);
  };

  // Handle start over - confirmed discard, with the reason + optional custom
  // text from the StartOverModal. We POST the feedback to
  // /api/trips/[id]/deletion-feedback BEFORE the soft-delete so we still
  // capture the WHY even if the discard itself hiccups. The feedback row is
  // independently useful — even without a matching tombstone we learn what
  // drove regret.
  const handleStartOver = async (
    reason: string,
    customReason: string | null,
  ) => {
    const savedTripId = autoSave.savedTripId;
    const wasAutoSaved = autoSaveEnabled && Boolean(savedTripId);

    // Capture analytics BEFORE the discard runs. Fire-and-forget so a
    // network blip on the feedback endpoint never traps the user in the
    // modal. The route itself fails-open.
    void (async () => {
      try {
        // Use the real trip id when we have one (auto-saved trip), else
        // a sentinel so the row still lands and we can identify pre-save
        // discards. The column is TEXT, not a FK.
        const feedbackTripId = savedTripId || "pre-save-draft";
        await fetch(`/api/trips/${feedbackTripId}/deletion-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason,
            custom_reason: customReason,
            destination,
            was_auto_saved: wasAutoSaved,
          }),
        });
      } catch (err) {
        console.warn("[startover] feedback log failed", err);
      }
    })();

    // If auto-save persisted a row, soft-delete it (sets deleted_at) before
    // resetting state so the user doesn't end up with an orphaned trip in
    // their dashboard. The row stays in the DB tombstoned, recoverable via
    // SQL (UPDATE deleted_at = NULL).
    if (wasAutoSaved) {
      await autoSave.discard();
    }
    clearDraft();
    // Nothing is displayed after Start Over — drop the
    // session stack's current pointer. The stacked snapshots themselves
    // survive (that's the tray's whole point across generations).
    clearSessionTripCurrent();
    setGeneratedItinerary(null);
    setShowStartOverModal(false);
    setStep(1);
    // Reset form
    setDestination("");
    setDestinationCoords(null);
    setStartDate("");
    setEndDate("");
    setBudgetTier("balanced");
    setPace("moderate");
    setSelectedVibes([]);
    setRequirements("");
    setMustDos([]);
    setMustDoInput("");
    setSeasonalContext(null);
    // Reset the multi-city rows too, or the sync effect rebuilds
    // destination/endDate from the stale route on its next run.
    // Restore the exact initial state from the useState declarations.
    setMultiCityMode(false);
    setCityRows([
      { city: "", nights: 3 },
      { city: "", nights: 2 },
    ]);
    setAnchors([]);
  };

  // Derive interests from selected vibes for AI prompt compatibility.
  // Declared as a `function` (not `const` arrow) so it's hoisted and
  // can be called by the auto-save hook setup that lives further up.
  function deriveInterestsFromVibes(): string[] {
    const interestSet = new Set<string>();
    selectedVibes.forEach((vibe) => {
      // TripVibe is a string type, use directly as key
      const interests = VIBE_TO_INTERESTS[vibe] || [];
      interests.forEach((interest) => interestSet.add(interest));
    });
    return Array.from(interestSet);
  }

  // The 21-day ceiling only holds when the request ACTUALLY fans out per city.
  // /api/ai/generate keys its cap off `legs.length > 1` (isMultiCity), so a
  // multi-city route with a single filled row is validated as a SINGLE-city
  // trip and a 21-day span 400s with "Maximum trip duration is 14 days" (and
  // the error banner's Retry button re-fires the same request). Keep this
  // predicate in lockstep with app/api/ai/generate/route.ts.
  const multiCityLegCount =
    MULTI_CITY_ENABLED && multiCityMode
      ? cityRows.filter((r) => r.city.trim() && r.nights > 0).length
      : 0;
  const effectiveMaxTripDays =
    multiCityLegCount > 1 ? MAX_TRIP_DAYS_MULTI : MAX_TRIP_DAYS;

  const canProceed = () => {
    switch (step) {
      case 1: {
        // Step 1: Destination + Dates combined.
        // Mirrors lib/gemini.ts validateTripParams so nothing that passes
        // this gate can bounce off the server's destination/date checks at
        // generate time. Rules:
        //   - destination 2..DESTINATION_MAX_LENGTH chars, allowlisted only
        //   - both dates parseable ("Invalid date format" guard)
        //   - end strictly after start (server rejects end <= start)
        //   - span within effectiveMaxTripDays (day-inclusive, same math as server)
        if (
          destination.length < 2 ||
          destination.length > DESTINATION_MAX_LENGTH ||
          !DESTINATION_ALLOWLIST.test(destination)
        ) {
          return false;
        }
        const span = tripSpanDaysInclusive(startDate, endDate);
        return span >= 2 && span <= effectiveMaxTripDays;
      }
      case 2:
        // Step 2: At least one vibe required, preferences have sensible defaults
        return selectedVibes.length > 0;
      default:
        return false;
    }
  };

  // Many step-1 visitors know WHERE but not exactly WHEN, and dates are a hard
  // gate to advance. One tap fills a sensible default (start ~3 weeks out,
  // 5-day trip) so they can reach a generated trip and fine-tune dates anytime.
  const handleFlexibleDates = () => {
    const today = new Date().toISOString().split("T")[0];
    const start = addDaysISO(today, 21);
    const end = addDaysISO(start, 4);
    setStartDate(start);
    setEndDate(end);
    setFlexibleDates(true);
    trackFieldInteraction("flexible_dates");
  };

  // ── One-tap starts ────────────────────────────────────────────────────────
  // A popular pick sets the destination and, when no dates exist, pencils in
  // the same flexible default the "I'm flexible" link uses (~3 weeks out, 5
  // days), so Continue lights and the reassurance line appears instead of a
  // disabled Continue. It does NOT advance: step 2 needs a vibe and the
  // seasonal seed is rarely loaded 100ms after a tap, so an auto-advance
  // would land on a second disabled button. Dates the person already chose
  // are never overwritten. Focus moves to the date trigger because the chip
  // that had focus unmounts (the `!destination` guard) — a keyboard or
  // screen-reader user must land on the field the tap just filled.
  const [datesPencilled, setDatesPencilled] = useState(false);
  const dateTriggerRef = useRef<HTMLButtonElement | null>(null);
  const handleOneTapStart = (place: OneTapPlace, index: number) => {
    trackFieldInteraction("destination_pill");
    setDestination(place.name);
    setDestinationCoords(place.coords);
    trackDestinationSelected({ destination: place.name, source: "popular" });
    let datesAutofilled = false;
    if (!startDate && !endDate && !(MULTI_CITY_ENABLED && multiCityMode)) {
      handleFlexibleDates();
      setDatesPencilled(true);
      datesAutofilled = true;
    }
    void captureWizardOneTapStart({
      destination: place.name,
      in_season: inSeasonMonth !== null && place.season.includes(inSeasonMonth),
      dates_autofilled: datesAutofilled,
      first_run: isFreshSignup,
      position: index,
    });
    requestAnimationFrame(() => dateTriggerRef.current?.focus());
  };

  // The sticky footer publishes its height so the cookie banner can sit just
  // above it on this route (components/consent/CookieConsentBanner.tsx).
  const footerRef = useRef<HTMLDivElement | null>(null);
  useCssVarHeight(footerRef, "--mt-footer-h");

  // The BuildHop feedback launcher (mounted in the root layout) is
  // position:fixed bottom-right at z-index 2147483000 — above this page's
  // fixed footer, i.e. on top of Continue at phone widths. Flag the document
  // while the wizard is mounted; app/globals.css hides the launcher below sm
  // on that flag. Every other route keeps it.
  useEffect(() => {
    document.documentElement.setAttribute("data-wizard-open", "");
    return () => document.documentElement.removeAttribute("data-wizard-open");
  }, []);

  // Footer state B: a valid destination with no dates. The slot offers an
  // ENABLED "Use flexible dates" instead of a disabled Continue with a hint,
  // on the step where most abandons happen. Label deliberately does not
  // match /continue|next/i so the e2e specs keep selecting the real one.
  const footerStateB =
    step === 1 &&
    destination.length >= 2 &&
    destination.length <= DESTINATION_MAX_LENGTH &&
    DESTINATION_ALLOWLIST.test(destination) &&
    !(startDate && endDate) &&
    !(MULTI_CITY_ENABLED && multiCityMode);

  // Handle destination selection from autocomplete
  const handleDestinationSelect = (prediction: PlacePrediction) => {
    if (prediction.coordinates) {
      setDestinationCoords(prediction.coordinates);
    }
    // Track destination selection
    trackDestinationSelected({
      destination: prediction.fullText,
      source: "autocomplete",
    });
  };

  const handleGenerate = async (opts: { fresh?: boolean } = {}) => {
    // A new itinerary replaces the one the edits were applied to.
    editsSinceGenerationRef.current = false;
    // Date guard. canProceed() only validates the span on step 1, but the span
    // can outlive the mode that allowed it: handleSessionTrayRestore forces
    // multiCityMode off (see its comment) and a route can drop to one filled
    // row after step 1. Both leave a 21-day span heading for a single-city
    // request the server rejects. Block it here - before the telemetry - so a
    // doomed attempt costs no round-trip and records no phantom "generating".
    const plannedSpan = tripSpanDaysInclusive(startDate, endDate);
    if (plannedSpan > effectiveMaxTripDays) {
      setError(t("wizard.datePicker.maxDaysLimit", { days: effectiveMaxTripDays }));
      setStep(1);
      return;
    }
    // Same reasoning as the date guard above, for the destination length
    // rule. Returning HERE — before bumpGenCount and before the `generating`
    // row — is the point: a doomed attempt should cost no round-trip and leave
    // no phantom "generating" that reads as a dead end in the funnel.
    if (destination.length > DESTINATION_MAX_LENGTH) {
      setError(t("wizard.step1.destinationTooLong"));
      setStep(1);
      return;
    }

    // Re-generating the SAME destination updates the saved row instead of
    // adding a second one. The Regenerate button calls autoSave.regenerate()
    // itself; this covers going back to step 1, changing the length or the
    // dates, and generating again. The server-side dedupe cannot catch that —
    // insert_trip_dedup locks on (user, lower(title), start_date) and the
    // whole point of the edit is that one of those changed.
    //
    // Gated on the destination being UNCHANGED. If you go back and plan a
    // different city, that is a different trip and must not overwrite the one
    // already saved — updating there would be data loss.
    if (
      autoSaveEnabled &&
      autoSave.savedTripId &&
      generatedItinerary &&
      isSameDestination(generatedItinerary.destination?.name, destination)
    ) {
      // Awaits any in-flight save so the next persist sees savedTripIdRef set
      // and takes the UPDATE branch, then clears the dedup ref so the incoming
      // itinerary actually triggers that persist.
      await autoSave.regenerate();
    }

    // Count every generation attempt of this browser session (mt_gen_count).
    // handleGenerate is the single choke point for ALL generations — the
    // Generate button, the error Retry, regenerate, post-auth resume — so
    // this is the one increment site.
    bumpGenCount();
    // Visitors generate first and sign up later (at Save). /api/ai/generate
    // accepts anonymous requests, rate-limited per cookie
    // (lib/anonymous/rate-limit.ts) with a per-IP backstop. The form draft is
    // persisted to localStorage so we can recover if the visitor closes the
    // tab mid-generation, AND it's what survives the signup modal at Save
    // time. Not once the trip is saved: the saved row is then the copy that
    // survives, and a draft beside it restores later as a duplicate (see the
    // draft effect above).
    if (destination && startDate && endDate && !savedTripId) {
      saveDraft({
        // Keep the draft's itinerary for the SAME destination (a re-generate
        // with dates or length tweaked), so anyone returning mid-wait — or
        // whose generation fails — doesn't find a blank form. Drop it when
        // the destination changed, because Rome's itinerary under Lisbon's
        // name is worse than nothing.
        generatedItinerary: (isSameDestination(draft?.destination, destination)
          ? draft?.generatedItinerary ?? null
          : null) as unknown as GeneratedItinerary,
        destination,
        startDate,
        endDate,
        pace,
        vibes: selectedVibes,
        budgetTier,
        travelStyle,
        anchors,
        mustDos,
        tripIntent,
      });
    }

    setGenerating(true);
    setError(null);

    // Start fetching the result-view chunks here, not when the result mounts.
    // handleGenerate is the single choke point for every generation path, so
    // this one call covers the Generate button, the error Retry, regenerate
    // and post-auth resume alike. See preloadResultViewChunks for why.
    preloadResultViewChunks();

    const generationStartTime = Date.now();
    captureTripWizardStepCompleted({
      step_number: 2,
      step_name: "vibes_preferences",
    });
    // Mark the wizard as completed so the abandonment listener doesn't
    // fire on the inevitable post-generation page transition.
    wizardCompletedRef.current = true;
    captureTripGenerationStarted({
      destination,
      duration_days: startDate && endDate
        ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0,
      budget_tier: budgetTier,
      // Forward the intent signal so PostHog funnels can filter
      // "started generation" by intent (solo vs group) and downstream
      // share/save rates.
      trip_intent: tripIntent,
    });
    // Supabase mirror — fired alongside the PostHog event so the funnel
    // is queryable in SQL.
    void trackWizardEvent("generating", {
      destination,
      duration_days:
        startDate && endDate
          ? Math.max(
              1,
              Math.ceil(
                (new Date(endDate).getTime() -
                  new Date(startDate).getTime()) /
                  (1000 * 60 * 60 * 24)
              ) + 1
            )
          : undefined,
      group_size: tripIntent,
      backpacker_mode: travelStyle === "backpacker",
      locale,
    });

    try {
      // Derive interests from vibes for API compatibility
      const derivedInterests = deriveInterestsFromVibes();

      // Multi-city: send the route legs so /api/ai/generate fans out per city.
      // `destination` already carries the combined label (synced effect above).
      const mcLegs =
        MULTI_CITY_ENABLED && multiCityMode
          ? cityRows
              .filter((r) => r.city.trim() && r.nights > 0)
              .map((r) => ({ city: r.city.trim(), nights: r.nights }))
          : null;
      const isMultiCity = !!(mcLegs && mcLegs.length > 1);

      const params: TripCreationParams = {
        destination,
        startDate,
        endDate,
        budgetTier,
        pace,
        vibes: selectedVibes,
        seasonalContext: seasonalContext || undefined,
        interests: derivedInterests, // Auto-derived from vibes
        requirements: requirements || undefined,
        // Must-do wishlist — undated wishes the plan must schedule.
        // Presence bypasses the cross-user cache server-side.
        ...(mustDos.length > 0 ? { mustDos } : {}),
        travelStyle,
        ...(isMultiCity ? { destinations: mcLegs! } : {}),
        // Anchored trips: fixed commitments the plan must build around.
        // Mutually exclusive with multi-city — the panel is hidden in
        // multi-city mode, and this guard keeps stale state out of the call.
        ...(!isMultiCity && anchors.length > 0 ? { anchors } : {}),
      };
      // Regenerate asks for a different plan: the server then skips its cache.
      const requestBody = opts.fresh ? { ...params, fresh: true } : params;

      // Reset stream progress for this generation.
      setStreamedDayCount(0);
      setStreamedTotalDays(0);

      // 1. Try the streaming endpoint first. If it fails before any data
      //    (rate-limit, validation, network), we fall through to the
      //    classic JSON endpoint for compatibility.
      // Explicit annotations: TypeScript narrows let-with-null-initial to
      // `never` when only assigned inside callbacks. The annotations keep
      // the conditional checks below well-typed.
      let streamedItinerary: GeneratedItinerary | null = null as GeneratedItinerary | null;
      let streamError: { error: string; code?: string } | null = null as { error: string; code?: string } | null;
      // Multi-city and anchored trips return one merged JSON body, not an SSE
      // stream — skip the streaming endpoint and let the JSON fallback below
      // carry `destinations`/`anchors`.
      const isAnchored = !isMultiCity && anchors.length > 0;

      // Anchor telemetry: how constrained is this trip? Fired at Generate (not at
      // panel-add) so it counts intent that actually reached generation.
      if (isAnchored) {
        const tripDays =
          Math.round(
            (new Date(`${endDate}T00:00:00Z`).getTime() -
              new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000
          ) + 1;
        captureAnchorsGenerated({
          anchor_count: anchors.length,
          anchor_types: Array.from(new Set(anchors.map((a) => a.type))),
          all_day_count: anchors.filter(
            (a) => a.type !== "lodging" && (a.time_slot ?? "all_day") === "all_day"
          ).length,
          lodging_count: anchors.filter((a) => a.type === "lodging").length,
          trip_days: tripDays,
        });
      }

      // Must-do telemetry: fired at Generate (like anchors above) so it counts
      // wishes that actually reached generation, not abandoned chips.
      if (mustDos.length > 0) {
        void capture("must_dos_generated", { must_do_count: mustDos.length });
      }
      if (!isMultiCity && !isAnchored) try {
        await streamGeneration(
          requestBody,
          {
            onMetadata: (meta) => {
              setStreamedTotalDays(meta.totalDays);
            },
            onDay: () => {
              // Don't push the day into generatedItinerary mid-stream —
              // wait for `complete` to set the canonical (sanitized,
              // image-enriched) version. Just bump the counter so the
              // GenerationProgress UI shows "Day N of M".
              setStreamedDayCount((c) => c + 1);
            },
            onComplete: (data) => {
              streamedItinerary = data.itinerary as GeneratedItinerary;
            },
            onError: (data) => {
              streamError = data;
            },
          },
          {}
        );
      } catch (err) {
        // Stream failed before any events. Most common: 429 (rate limit)
        // or 503 (Gemini disabled). We log and fall through to the JSON
        // endpoint, which surfaces the same errors with full client UX.
        console.warn("[generate] streaming endpoint failed, falling back to JSON:", err);
      }

      // 2. Fallback to the classic JSON endpoint if streaming didn't
      //    deliver a final itinerary. Four cases get us here:
      //      (a) streamGeneration() threw before any events (rate-limit,
      //          dev-key revoked, network 5xx) — caught above.
      //      (b) it completed without a `complete` event (rare).
      //      (c) the server emitted HTTP 200 then an SSE `error` event
      //          mid-flight (transient Gemini upstream blip, parser
      //          exception, model overload). Don't throw on `streamError`
      //          before this fallback: the JSON route has cache hits + a
      //          graceful LIMIT_REACHED UI gate, so only re-throw if it
      //          ALSO fails to produce an itinerary.
      //      (d) multi-city and anchored trips skip streaming entirely.
      let data: { itinerary?: GeneratedItinerary; usage?: { used?: number; limit?: number }; code?: string; error?: string };
      if (streamedItinerary) {
        data = { itinerary: streamedItinerary };
      } else {
        const response = await fetch("/api/ai/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        data = await response.json();

        if (!response.ok) {
          // The anonymous free-generation cap (RATE_LIMIT from both
          // endpoints: the stream refused, and so did this fallback). Ask
          // for a free account, with the destination kept for the way back,
          // instead of throwing the server's English error.
          if (response.status === 429 && data.code === "RATE_LIMIT" && !authUser) {
            setAuthPromptLocation("wizard_generation_limit");
            setAuthPromptReason("generation_limit");
            setShowAuthModal(true);
            setGenerating(false);
            return;
          }
          // If the stream errored AND the JSON fallback also failed,
          // surface the stream error message (more specific) when
          // available, otherwise fall back to the JSON error.
          throw new Error(streamError?.error || data.error || "Generation failed");
        }
      }

      // Images are fetched server-side in both endpoints; the itinerary
      // already has image_url populated on each activity.
      setGeneratedItinerary(data.itinerary || null);

      // Push the successful generation onto the session trip
      // stack. This is the ONLY generation success site — the streaming path
      // funnels into `data.itinerary` via streamedItinerary above, and the
      // JSON fallback lands here too. Restores (draft/tray) never push from
      // here; they go through registerRestore/swapTo, so recordGeneration's
      // restored-entry dedupe keeps the stack duplicate-free.
      if (data.itinerary) {
        recordSessionGeneration({
          destination,
          startDate,
          endDate,
          dayCount: data.itinerary.days.length,
          itinerary: data.itinerary,
          pace,
          vibes: selectedVibes,
          budgetTier,
          travelStyle,
        });
      }

      // Supabase funnel mirror — fired only when we actually have an
      // itinerary to render.
      if (data.itinerary) {
        const durationDaysResult =
          startDate && endDate
            ? Math.max(
                1,
                Math.ceil(
                  (new Date(endDate).getTime() -
                    new Date(startDate).getTime()) /
                    (1000 * 60 * 60 * 24)
                ) + 1
              )
            : undefined;
        void trackWizardEvent("result", {
          destination,
          duration_days: durationDaysResult,
          group_size: tripIntent,
          backpacker_mode: travelStyle === "backpacker",
          locale,
        });
        // Itinerary-level first value — the "first magical output" row the
        // funnel SQL reads alongside `result`.
        void trackWizardEvent("first_value", {
          destination,
          duration_days: durationDaysResult,
          locale,
        });
      }

      // Track successful itinerary generation, timed from the start of THIS
      // request (`Date.now() - performance.now()` would be Unix-epoch minus
      // page-life-ms, a meaningless number).
      const generationTime = Date.now() - generationStartTime;
      const durationDaysGenerated = Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

      // GA4 tracking
      trackItineraryGenerated({
        destination,
        duration: durationDaysGenerated,
        budgetTier,
        generationTimeMs: Math.round(generationTime),
      });

      // PostHog tracking
      captureItineraryGenerated({
        destination,
        duration_days: durationDaysGenerated,
        budget_tier: budgetTier,
        generation_time_ms: Math.round(generationTime),
      });

      // Activation funnel tracking
      captureTripGenerationCompleted({
        destination,
        duration_days: durationDaysGenerated,
        budget_tier: budgetTier,
        generation_time_seconds: Math.round((Date.now() - generationStartTime) / 1000),
        success: true,
        trip_intent: tripIntent,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      // `abandoned` cannot follow `generating` (wizardCompletedRef is set
      // before the request fires), so without this row a failed generation
      // is indistinguishable from someone closing the tab. The failure_code
      // separates the buckets without anyone reading a stack trace.
      void trackWizardEvent("generation_failed", {
        destination,
        locale,
        failure_code: classifyGenerationFailure(err),
      });
      captureTripGenerationCompleted({
        destination,
        duration_days: startDate && endDate
          ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0,
        budget_tier: budgetTier,
        generation_time_seconds: Math.round((Date.now() - generationStartTime) / 1000),
        success: false,
        error_type: err instanceof Error ? err.message : "unknown",
        trip_intent: tripIntent,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveTrip = async () => {
    if (!generatedItinerary) return;
    // No-op when the auto-save flow has already persisted the trip.
    // Defense in depth — the UI hides this button when autoSave.savedTripId
    // is set, but a child component (ValuePropositionBanner's onSave, the
    // assistant's save bridge) could still invoke it.
    if (autoSaveEnabled && autoSave.savedTripId) return;
    // Synchronous re-entry guard: setLoading(true) below is async, and a
    // user can click a second time in the gap before React re-renders the
    // disabled button. The ref check fires before any state update lands.
    if (savingTripRef.current) return;
    savingTripRef.current = true;

    // Supabase funnel mirror — fired on the user's Save tap regardless
    // of auth state. This captures the "peak intent" event before the
    // auth modal potentially intercepts.
    void trackWizardEvent("save_clicked", {
      destination,
      duration_days:
        startDate && endDate
          ? Math.max(
              1,
              Math.ceil(
                (new Date(endDate).getTime() -
                  new Date(startDate).getTime()) /
                  (1000 * 60 * 60 * 24)
              ) + 1
            )
          : undefined,
      group_size: tripIntent,
      backpacker_mode: travelStyle === "backpacker",
      locale,
    });

    setLoading(true);
    try {
      // Read auth from the central AuthProvider rather than firing another
      // getUser() round-trip. The subsequent supabase INSERT below still
      // goes through the per-request client (RLS will re-verify the session
      // on the wire).
      const user = authUser;
      const supabase = createClient();

      if (!user) {
        // This is the auth wall; generating needs no account (up to the
        // anonymous cap). The user just saw their generated itinerary and
        // clicked Save — peak motivation, the right moment to ask for an
        // account. The draft logic (saveDraft + pendingTripGeneration flag)
        // persists the trip so it'll be restored after signup.
        if (generatedItinerary) {
          saveDraft({
            generatedItinerary,
            destination,
            startDate,
            endDate,
            pace,
            vibes: selectedVibes,
            budgetTier,
            // Backpacker mode must survive the auth round trip, like the
            // generate-time draft write; without it the post-signup restore
            // silently drops the flag.
            travelStyle,
            // Same for the must-do wishlist.
            mustDos,
            // Same for anchors: without this, the post-signup save would
            // silently drop trip_meta.anchors.
            anchors,
            // ...and the same for the "Who's coming?" answer.
            tripIntent,
          });
        }
        // Funnel disambiguation: without this event we can't tell "user
        // bounced at auth wall" from "save genuinely errored" in the
        // save_clicked → saved gap.
        void trackWizardEvent("save_blocked_anon", {
          destination,
          group_size: tripIntent,
          backpacker_mode: travelStyle === "backpacker",
          locale,
        });
        // PostHog mirror so the same funnel renders in the product
        // analytics dashboard alongside save_clicked → saved. Without
        // this, the gap shows in Supabase queries but is invisible in
        // PostHog funnel charts the team actually watches.
        // Sync (nav-safe) since the auth modal opens right after.
        captureSaveBlockedAnon({
          destination,
          group_size: tripIntent,
          backpacker_mode: travelStyle === "backpacker",
          modal_shown: true,
        });
        setLoading(false);
        savingTripRef.current = false;
        setAuthPromptReason("save");
        setShowAuthModal(true);
        return;
      }

      // Fetch a proper cover image for this destination
      let coverImageUrl: string | undefined;
      try {
        const imageResponse = await fetch(
          `/api/images/destination?destination=${encodeURIComponent(generatedItinerary.destination.name)}`
        );
        if (imageResponse.ok) {
          const imageData = await imageResponse.json();
          coverImageUrl = imageData.url;
        }
      } catch (imageError) {
        console.error("Failed to fetch cover image:", imageError);
      }

      // Fallback: Try to find a high-quality activity image
      if (!coverImageUrl) {
        for (const day of generatedItinerary.days) {
          for (const activity of day.activities) {
            // Prefer Google Places photos (they have maps.googleapis.com)
            if (activity.image_url && activity.image_url.includes("googleapis.com")) {
              coverImageUrl = activity.image_url;
              break;
            }
          }
          if (coverImageUrl) break;
        }
      }

      // Build trip metadata from generated itinerary (preserves AI-generated data)
      const tripMeta = {
        // Provenance - the same two keys the auto arm writes via SaveOrigin,
        // so a duplicate pair states which arm produced each row and whether
        // they came from the same wizard mount. Never infer the arm from
        // trip_meta.destination's absence: both arms write that key (see
        // below).
        save_arm: "manual" as const,
        ...(wizardMountIdRef.current
          ? { wizard_mount_id: wizardMountIdRef.current }
          : {}),
        // Canonical user-specified destination + structured route legs, as
        // the auto arm (lib/trips/persistTrip.ts buildTripRow) writes them.
        // Without them getTripDestination() falls back to stripping " Trip"
        // off the title, which is documented to break on non-English,
        // renamed, and multi-city titles. `destination` holds joinCities(...)
        // for multi-city, so `cities` is derivable the same way the auto arm
        // derives it. Gated on a non-empty value so we never store "".
        ...(destination.trim()
          ? {
              destination: destination.trim(),
              ...(splitCities(destination.trim()).length > 1
                ? { cities: splitCities(destination.trim()) }
                : {}),
            }
          : {}),
        weather_note: generatedItinerary.destination.weather_note,
        highlights: generatedItinerary.trip_summary.highlights,
        booking_links: generatedItinerary.booking_links,
        destination_best_for: generatedItinerary.destination.best_for,
        // The language the text was generated in (stamped by the generate
        // routes; the UI locale covers responses without it). Every later
        // AI edit reads this before the visitor's cookie.
        locale: generatedItinerary.language ?? resolveAiLanguage(locale),
        packing_suggestions: generatedItinerary.trip_summary.packing_suggestions,
        // Anchors: persist the fixed commitments this trip was built
        // around so regeneration/editing keeps honouring them.
        ...(anchors.length > 0 ? { anchors } : {}),
        // Must-dos: same source-of-truth reasoning as anchors.
        ...(mustDos.length > 0 ? { must_dos: mustDos } : {}),
        // Pace the trip was generated at — the feasibility strip on the
        // detail/share views reads it to pick the day-time budget.
        pace,
      };

      // Atomic server-side dedupe: a client check-then-insert catches slow
      // double-clicks but not concurrency (e.g. this path racing the
      // auto-save arm). The insert_trip_dedup RPC advisory-locks (user,
      // title, start_date), runs the 60s-window reuse check, and inserts —
      // atomically. It also catches cross-tab double-save,
      // hard-refresh-then-resave, and any client guard regression. RLS
      // applies (SECURITY INVOKER); user_id is taken from auth.uid()
      // server-side.
      const tripTitle = `${generatedItinerary.destination.name} Trip`;
      const { data: dedupSave, error: tripError } = await supabase
        .rpc("insert_trip_dedup", {
          p_row: {
            title: tripTitle,
            description: generatedItinerary.destination.description,
            start_date: startDate,
            end_date: endDate,
            status: "planning",
            visibility: "private",
            // Stored with activity ids: the photo enrichment fired right after
            // this insert merges by id, and an id-less trip would make the
            // trip page mint and save ids of its own, racing it.
            itinerary: ensureActivityIds(generatedItinerary.days),
            cover_image_url: coverImageUrl,
            budget: {
              total: generatedItinerary.trip_summary.total_estimated_cost,
              spent: 0,
              currency: generatedItinerary.trip_summary.currency,
            },
            tags: deriveInterestsFromVibes(), // Auto-derived from vibes
            trip_meta: tripMeta, // Preserve AI-generated metadata
            packing_list: generatedItinerary.trip_summary.packing_suggestions, // Also store in packing_list column
          },
        })
        .single();

      if (tripError) throw tripError;
      const dedupRow = dedupSave as { trip_id: string; reused: boolean } | null;
      if (!dedupRow?.trip_id) throw new Error("Trip insert returned no id");
      const trip: { id: string } = { id: dedupRow.trip_id };

      // Upgrade curated activity images to real place photos for the KEPT
      // trip, as the autosave arm does via persistTrip; otherwise saved trips
      // keep their generation-time thematic fallbacks. Fire-and-forget with
      // keepalive so it survives the same-tab navigation to /trips/[id].
      if (!dedupRow.reused) {
        try {
          void fetch(`/api/trips/${trip.id}/enrich-photos`, {
            method: "POST",
            keepalive: true,
          }).catch(() => {});
        } catch {
          // Best-effort — never block or fail the save on photo enrichment.
        }
      }

      // Calculate trip duration
      const durationDays = Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

      // Analytics emission — gated on the durable, trip-id-keyed idempotency
      // guard. handleSaveTrip can run several times for ONE trip on the
      // login-return remount (auto-invoked by the save-intent effect on each
      // mount, plus a possible manual re-click); the 60s dedup reuses the row
      // (dedupRow.reused above) but these captures don't check that, so they
      // would inflate activation metrics. The guard makes each fire exactly
      // once per trip.
      if (claimTripCreatedEmit(trip.id)) {
        // Track trip creation (GA4)
        trackTripCreated({
          tripId: trip.id,
          destination,
          duration: durationDays,
          budgetTier,
          isFromTemplate: false,
        });

        // Supabase funnel mirror — fired on successful manual-save INSERT.
        // The auto-save path fires its own `saved` event in handlePersisted
        // above so both flows reach this terminal funnel state.
        void trackWizardEvent("saved", {
          destination,
          duration_days: durationDays,
          group_size: tripIntent,
          backpacker_mode: travelStyle === "backpacker",
          locale,
        });

        // Fire first_trip_saved here for organic and referred users alike
        // (handleTripCreatedWithReferral does not fire it). Deduped on
        // trip.id by the guard above.
        try {
          captureFirstTripSaved({
            trip_id: trip.id,
            destination,
            duration_days: durationDays,
            time_to_value_minutes: 0, // signup-time not threaded here
            from_template: false,
            is_anchored: anchors.length > 0,
            anchor_count: anchors.length,
          });
        } catch (e) {
          console.error("[Trip Save] first_trip_saved error:", e);
        }

        // Track in PostHog + Complete referral if eligible (async, non-blocking)
        handleTripCreatedWithReferral(
          trip.id,
          destination,
          durationDays,
          budgetTier,
          false // not from template
        ).catch((err) => {
          console.error("[Trip Save] Error in referral/tracking:", err);
        });
      }

      // Clear draft on successful save
      clearDraft();

      // Prevent ProfileCompletionModal from showing after trip creation
      // Users just completed a complex flow, don't interrupt with another modal
      if (typeof window !== "undefined") {
        safeSet("profile_modal_shown", "true", "session");
      }

      // Go straight to the trip. The share ask waits until the user has
      // actually looked at the itinerary, on the trip page itself
      // (components/trip/SharePromptOnTrip.tsx).
      setSavedTripId(trip.id);
      router.push(`/trips/${trip.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trip");
      // Funnel marker: this is the AUTHED-save genuine-failure path
      // (INSERT errored, RLS rejected, network died, etc). Distinct from
      // save_blocked_anon (anon user hit the auth wall). If this fires
      // even once in a 2h watcher window we want to wake up — it means
      // a real user lost a real trip after a real save click.
      void trackWizardEvent("save_failed", {
        destination,
        group_size: tripIntent,
        backpacker_mode: travelStyle === "backpacker",
        locale,
      });
      // PostHog mirror — bucketed error_class so dashboards can chart
      // network vs RLS vs validation drops separately. Raw message is
      // truncated; PostHog gets a short string only.
      const errMsg = err instanceof Error ? err.message : "";
      const errorClass: "network" | "rls" | "validation" | "rate_limit" | "unknown" =
        /network|fetch|ECONN|timeout/i.test(errMsg)
          ? "network"
          : /rls|row-level|policy|permission/i.test(errMsg)
          ? "rls"
          : /rate.?limit|429/i.test(errMsg)
          ? "rate_limit"
          : /invalid|required|missing|validation/i.test(errMsg)
          ? "validation"
          : "unknown";
      // Sync (nav-safe) — save error can be followed by an immediate
      // page transition if the user retries elsewhere.
      captureSaveFailed({
        destination,
        group_size: tripIntent,
        backpacker_mode: travelStyle === "backpacker",
        error_class: errorClass,
        error_message: errMsg.slice(0, 80) || undefined,
      });
    } finally {
      setLoading(false);
      // Always clear the re-entry guard so a legitimate retry (e.g. after
      // a transient network error) is not permanently blocked.
      savingTripRef.current = false;
    }
  };

  // ── Redeem the pre-signup Save intent ─────────────────────────────────────
  // An anonymous user who clicks Save hits the auth wall, signs up via magic
  // link, and returns to /trips/new with the itinerary silently restored
  // (draftAutoRestored === true). With auto-save switched off nothing then
  // persists that trip, so this honours the Save click they already made by
  // invoking the same tested handleSaveTrip once.
  //
  // Safety / no double-save:
  //  - Runs only when auto-save is off (shouldRedeemSaveIntent), so it never
  //    races the auto-save hook.
  //  - draftAutoRestored is set only by the silent auto-restore of a signed-in
  //    user's draft (lib/wizard/draft-restore.ts), never by banner recovery or
  //    a normal authed generation. That restore also runs for a signed-in
  //    return that never clicked Save, and this saves those drafts too.
  //  - Idempotent: one-shot ref + savedTripId / autoSave.savedTripId checks;
  //    handleSaveTrip's own re-entry guard (savingTripRef) and the 60s server-
  //    side dedupe are the backstops against a duplicate row.
  useEffect(() => {
    if (saveIntentRedeemedRef.current) return;
    if (!isAuthenticated) return;
    if (!shouldRedeemSaveIntent(process.env.NEXT_PUBLIC_AUTO_SAVE_FORCE)) return;
    if (!draftAutoRestored || !generatedItinerary) return;
    if (savedTripId || autoSave.savedTripId) return; // already persisted
    if (savingTripRef.current) return; // a save is already in flight
    saveIntentRedeemedRef.current = true;
    // Observability: quantify how many activations this recovers. PostHog
    // (unlike trackWizardEvent) has no event-name enum, so this needs no
    // migration.
    posthog.capture("save_intent_redeemed", {
      destination,
      group_size: tripIntent,
      backpacker_mode: travelStyle === "backpacker",
      locale,
    });
    void handleSaveTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuthenticated,
    draftAutoRestored,
    generatedItinerary,
    savedTripId,
    autoSave.savedTripId,
  ]);

  // Apply one assistant reply to the in-memory itinerary: every day it changes
  // and, when it adds or removes days, the trip's new length (the end date
  // follows, so a saved trip's auto-save writes it too). Recomputes the trip
  // total so hero/sticky/overview/export/saved-budget stay in sync, carries
  // ids, map data and photos over by name across all the edited days (so a
  // moved activity keeps its photo; lib/trips/day-edit-merge.ts), and scrolls
  // the first changed day into view.
  const handleApplyAssistantEdits = useCallback(
    (edits: AssistantDayEdit[], tripLength?: number) => {
      // Remember that this session applied an assistant edit
      // (forwarded on result_exit_unsaved as edits_applied).
      editsAppliedRef.current = true;
      editsSinceGenerationRef.current = true;
      // Best-effort mirror for the post-auth round trip. When storage is
      // blocked safeSet just returns false; the ref covers this page's life.
      safeSet("mt_edits_applied", "1", "session");
      const start = startDateRef.current;
      setGeneratedItinerary((prev) => {
        if (!prev) return prev;
        const days = applyAssistantEdits(prev.days, edits, { tripLength, startDate: start || undefined });
        const sum = (ds: ItineraryDay[]) =>
          ds.reduce((t, d) => t + (d.activities ?? []).reduce((s, a) => s + (a.estimated_cost?.amount || 0), 0), 0);
        const prevTotal = prev.trip_summary?.total_estimated_cost || 0;
        // Delta on the activities, so any non-activity share of the total stays.
        const newTotal = Math.max(0, Math.round(prevTotal - sum(prev.days) + sum(days)));
        return {
          ...prev,
          days,
          trip_summary: { ...prev.trip_summary, total_estimated_cost: newTotal },
        };
      });
      if (tripLength !== undefined && start) setEndDate(addDaysISO(start, tripLength - 1));
      const dayNumber = edits[0]?.day_number ?? tripLength ?? 1;
      setTimeout(() => {
        const el = document.getElementById(`day-${dayNumber}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.classList.add("ring-2", "ring-[var(--primary)]");
          setTimeout(() => el.classList.remove("ring-2", "ring-[var(--primary)]"), 2000);
        }
      }, 100);
    },
    []
  );

  // New dates for the generated trip, from the hero's date chip or from Start
  // Over's "wrong dates" (often dates "I'm flexible" pencilled in), so wrong
  // dates don't cost the whole plan. The plan moves with the dates; a shorter
  // trip keeps its first days; a longer one gets its new days from the
  // assistant (only the new days: the ones already planned stay exactly as
  // they are).
  const handleChangeDates = async (start: string, end: string) => {
    const itinerary = generatedItinerary;
    if (!itinerary) return;
    const current = itinerary.days.length;
    const change = planDateChange(current, start, end, effectiveMaxTripDays);
    if (change.kind === "invalid") return;
    setShowChangeDates(false);
    setDatesNotice(null);
    const keep = Math.min(current, change.length);
    const moved = moveItineraryDates(itinerary.days, start, keep);
    setGeneratedItinerary((prev) => {
      if (!prev) return prev;
      const sum = (ds: ItineraryDay[]) =>
        ds.reduce((t, d) => t + (d.activities ?? []).reduce((s, a) => s + (a.estimated_cost?.amount || 0), 0), 0);
      const prevTotal = prev.trip_summary?.total_estimated_cost || 0;
      return {
        ...prev,
        days: moveItineraryDates(prev.days, start, keep),
        trip_summary: {
          ...prev.trip_summary,
          total_estimated_cost: Math.max(0, Math.round(prevTotal - sum(prev.days) + sum(moved))),
        },
      };
    });
    setStartDate(start);
    setEndDate(addDaysISO(start, keep - 1));
    // The traveller chose these dates, so they are not pencilled in.
    setFlexibleDates(false);
    setDatesPencilled(false);
    posthog.capture("wizard_dates_changed", { from_days: current, to_days: change.length, kind: change.kind });
    if (change.kind !== "longer") return;

    const extra = change.length - current;
    setPlanningExtraDays(true);
    try {
      const res = await fetch("/api/ai/assistant-anon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Add ${extra} more ${extra === 1 ? "day" : "days"} at the end of the trip (${
            extra === 1 ? `Day ${current + 1}` : `Days ${current + 1} to ${change.length}`
          }), planned like the other days, and set trip_length to ${change.length}. Leave the existing days as they are.`,
          destination: `${itinerary.destination.name}, ${itinerary.destination.country}`,
          tripTitle: `${itinerary.destination.name} Trip`,
          days: moved,
          startDate: start,
          endDate: addDaysISO(start, current - 1),
          locale: itinerary.language ?? locale,
          history: [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      const payload = data?.data ?? data ?? {};
      const planned = Math.min(typeof payload.tripLength === "number" ? payload.tripLength : 0, change.length);
      // Only the new days: the plan the traveller already has is not the ask.
      const newDays: AssistantDayEdit[] = (Array.isArray(payload.edits) ? payload.edits : []).filter(
        (e: AssistantDayEdit) => e && e.day_number > current && e.day_number <= planned
      );
      if (res.ok && planned > current && newDays.length > 0) {
        handleApplyAssistantEdits(newDays, planned);
        if (planned < change.length) setDatesNotice(t("wizard.changeDates.partlyPlanned", { count: planned }));
      } else {
        setDatesNotice(t("wizard.changeDates.extraFailed", { count: current }));
      }
    } catch {
      setDatesNotice(t("wizard.changeDates.extraFailed", { count: current }));
    } finally {
      setPlanningExtraDays(false);
    }
  };

  // Flip the result view to an earlier generation from the session tray.
  // Refreshes the currently displayed trip into the stack first (so applied
  // assistant edits survive the swap), then restores the clicked snapshot via
  // the SAME state operations as the post-auth draft-restore effect above:
  // destination/dates/pace/vibes/budgetTier/travelStyle +
  // setGeneratedItinerary. Two deliberate differences:
  //   - travelStyle is set BOTH ways (the draft path only upgrades a fresh
  //     form to backpacker; a swap can also go backpacker → classic).
  //   - coords cleared (the draft path never restores them either) and
  //     multiCityMode forced off, otherwise the multi-city sync effect
  //     rebuilds destination/endDate from stale cityRows and clobbers the
  //     restored values on its next run.
  // Only reachable while sessionTrayVisible (unsaved + auto-save arm not
  // active), so a swap can never UPDATE/INSERT a persisted trip row.
  const handleSessionTrayRestore = (id: string) => {
    if (!generatedItinerary || id === sessionTripCurrentId) return;
    const snap = swapSessionTrip(id, {
      destination,
      startDate,
      endDate,
      dayCount: generatedItinerary.days.length,
      itinerary: generatedItinerary,
      pace,
      vibes: selectedVibes,
      budgetTier,
      travelStyle,
    });
    if (!snap) return;
    void capture("save_nudge_action", {
      source: "session_tray",
      action: "restore",
      gen_count: getGenCount(),
    });
    setDestination(snap.destination);
    setStartDate(snap.startDate);
    setEndDate(snap.endDate);
    setPace(snap.pace as "relaxed" | "moderate" | "active");
    setSelectedVibes(snap.vibes as TripVibe[]);
    setBudgetTier(snap.budgetTier as "budget" | "balanced" | "premium");
    setTravelStyle(snap.travelStyle === "backpacker" ? "backpacker" : "classic");
    setGeneratedItinerary(snap.itinerary);
    setDestinationCoords(null);
    setMultiCityMode(false);
    // Session-tray snapshots don't carry anchors — clear so a swapped trip
    // never inherits another trip's fixed commitments.
    setAnchors([]);
    setError(null);
  };

  // Show generated itinerary
  if (generatedItinerary) {
    const fullDestination = `${generatedItinerary.destination.name}, ${generatedItinerary.destination.country}`;
    // Multi-city: route stops (city + consecutive nights + transit labels
    // from the merged transfer legs) for the Journey ribbon. Empty on
    // single-city trips.
    const mcStops = buildJourneyStops(generatedItinerary.days, locale);

    // Calculate total activities for modal
    const totalActivities = generatedItinerary.days.reduce((acc, day) => acc + day.activities.length, 0);

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white pb-24 sm:pb-8">
        <ChangeDatesModal
          isOpen={showChangeDates}
          onClose={() => setShowChangeDates(false)}
          startDate={startDate}
          endDate={endDate}
          currentDays={generatedItinerary.days.length}
          maxDays={effectiveMaxTripDays}
          minDate={new Date().toISOString().split("T")[0]}
          maxStartDate={MAX_TRIP_START_DATE}
          onConfirm={(start, end) => void handleChangeDates(start, end)}
        />

        {/* A full regenerate replaces the assistant's edits: ask first. */}
        <BaseModal
          isOpen={confirmRegenerate}
          onClose={() => setConfirmRegenerate(false)}
          // Above the sticky result bar (also z-50, later in the page), which
          // would otherwise cover the dialog and swallow clicks on its buttons.
          usePortal
          zIndex={100}
          title={t("wizard.regenerateConfirm.title")}
        >
          <p className="text-sm text-slate-600">{t("wizard.regenerateConfirm.body")}</p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirmRegenerate(false)}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t("wizard.regenerateConfirm.keep")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRegenerate(false);
                void handleRegenerate();
              }}
              className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--primary-light)]"
            >
              {t("wizard.regenerateConfirm.regenerate")}
            </button>
          </div>
        </BaseModal>

        {/* Start Over Modal */}
        <StartOverModal
          isOpen={showStartOverModal}
          onClose={() => setShowStartOverModal(false)}
          onConfirm={handleStartOver}
          destination={fullDestination}
          tripDays={generatedItinerary.days.length}
          activitiesCount={totalActivities}
          wasAutoSaved={autoSaveEnabled && Boolean(autoSave.savedTripId)}
          onChangeDatesInstead={
            mcStops.length > 1
              ? undefined
              : () => {
                  posthog.capture("wizard_start_over_changed_dates_instead");
                  setShowStartOverModal(false);
                  setShowChangeDates(true);
                }
          }
        />

        {/* No share or publish modal here: the post-save share ask lives on
            /trips/[id] (SharePromptOnTrip) behind an engagement gate, and
            PublishTripModal lives only on /trips/[id] (see PublishToggle). */}

        {/* Auth Prompt Modal — anonymous user clicks Save Trip on the
            generated itinerary. It must be mounted in this result-view
            return as well as the form view's: without it,
            setShowAuthModal(true) from handleSaveTrip opens nothing and
            Save is a dead button. */}
        <AuthPromptModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          destination={destination}
          location={authPromptLocation}
          reason={authPromptReason}
          redirectPath={limitRedirectPath}
        />

        {/* Hero with Cover Image */}
        <DestinationHero
          destination={fullDestination}
          title={fullDestination}
          subtitle={generatedItinerary.destination.description}
          dateRange={formatDateRangeLocalized(startDate, endDate, locale)}
          onEditDates={planningExtraDays || mcStops.length > 1 ? undefined : () => setShowChangeDates(true)}
          editDatesLabel={t("wizard.changeDates.button")}
          budget={{
            total: generatedItinerary.trip_summary.total_estimated_cost,
            currency: generatedItinerary.trip_summary.currency,
          }}
          days={generatedItinerary.days.length}
          tags={generatedItinerary.destination.best_for}
          showBackButton={false}
        />

        {/* Dates: pencilled in for the traveller, being extended, or a longer
            trip whose extra days could not be planned. Multi-city dates come
            from per-city nights, so the change control stays out of it. */}
        {mcStops.length <= 1 && (flexibleDates || planningExtraDays || datesNotice) && (
          <div className="max-w-6xl mx-auto px-4 pt-4">
            <div aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
              {planningExtraDays ? (
                <span>{t("wizard.changeDates.planning")}</span>
              ) : datesNotice ? (
                <span>{datesNotice}</span>
              ) : (
                <>
                  <span>{t("wizard.changeDates.pencilled", { range: formatDateRangeLocalized(startDate, endDate, locale) })}</span>
                  <button
                    type="button"
                    onClick={() => setShowChangeDates(true)}
                    className="font-semibold text-slate-900 underline underline-offset-2 hover:text-slate-700"
                  >
                    {t("wizard.changeDates.setYourDates")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Multi-city: the Journey ribbon hero (only when the trip spans >1 city) */}
        {mcStops.length > 1 && (
          <div className="max-w-6xl mx-auto px-4 pt-4">
            <JourneyRibbon stops={mcStops} />
          </div>
        )}

        {/* Enhanced Sticky Header - Desktop */}
        <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200 hidden sm:block">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            {/* Start Over Button */}
            <button
              onClick={() => setShowStartOverModal(true)}
              className="flex items-center gap-2 text-slate-600 hover:text-amber-600 transition-colors px-3 py-2 rounded-lg hover:bg-amber-50"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {t("wizard.result.startOver")}
            </button>

            {/* Trip Summary */}
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="px-2 py-1 bg-slate-100 rounded-lg">
                {t("wizard.result.days", { count: generatedItinerary.days.length })}
              </span>
              <span className="px-2 py-1 bg-slate-100 rounded-lg">
                {convertCurrency(
                  generatedItinerary.trip_summary.total_estimated_cost,
                  generatedItinerary.trip_summary.currency
                ).formatted}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Export (PDF / iCal) — desktop sticky header only, and only
                  AFTER save: a pre-save export is a "take the plan and leave"
                  escape hatch at the exact moment the user should save. */}
              {savedTripId && (
                <ExportMenu
                  trip={{
                    title: `${generatedItinerary.destination.name} Trip`,
                    description: generatedItinerary.destination.description,
                    startDate,
                    endDate,
                    budget: {
                      total: generatedItinerary.trip_summary.total_estimated_cost,
                      currency: generatedItinerary.trip_summary.currency,
                    },
                    itinerary: generatedItinerary.days,
                  }}
                  destination={fullDestination}
                  surface="anon_result"
                />
              )}
              <RegenerateButton
                onRegenerate={requestRegenerate}
                isRegenerating={isRegenerating || generating}
                variant="compact"
              />
              {/* Ask your crew to vote — surfaces the crew-input intent at the
                  peak moment. Saved trip → deep-link to the vote/invite tab;
                  unsaved → handleSaveTrip, which saves and opens the trip
                  page. */}
              {/* Hidden for a signed-out planner with nothing saved yet: in that
                  state this button's else-branch calls handleSaveTrip(), i.e. the
                  auth wall — and AnonymousShareButton, rendered a few lines
                  below, offers the no-signup path. Showing both would put the
                  walled door next to the open one (the mobile sticky bar follows
                  the same rule). Authenticated users (and anyone who has saved)
                  keep it. Signed-out planners keep the vote ask: on a
                  group-intent trip the AnonymousShareButton below runs in "crew"
                  mode and IS the vote ask, minus the account. */}
              {!(isAuthenticated === false && !savedTripId) && (
              <button
                type="button"
                onClick={() => {
                  const existingId = savedTripId || (autoSaveEnabled ? autoSave.savedTripId : null);
                  if (existingId) {
                    router.push(`/trips/${existingId}?share=invite`);
                  } else {
                    handleSaveTrip();
                  }
                }}
                className="hidden md:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[var(--secondary)] text-[var(--secondary-ink)] hover:bg-[var(--secondary)]/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
                {t("wizard.result.shareForVotes")}
              </button>
              )}
              {/* Save motivation at the PERSISTENT save point. The desktop
                  ValuePropositionBanner sits once above the schedule and
                  scrolls away, leaving this sticky-header Save button with no
                  "why" as the user reads a long itinerary; this concise
                  free/benefit line is the desktop twin of the mobile nudge.
                  Hidden once saved; lg+ only so it doesn't crowd the header on
                  narrow desktops. */}
              {!savedTripId && (
                <span className="hidden lg:flex items-center gap-1.5 text-xs font-medium text-emerald-600 whitespace-nowrap">
                  <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {t("wizard.result.saveHeaderNudge", {
                    count: generatedItinerary.days.length,
                  })}
                </span>
              )}
              {/* Unsaved-state pill (both save arms). */}
              {isUnsaved && <NotSavedPill />}
              {autoSaveEnabled && autoSave.savedTripId && autoSave.status !== "saving" ? (
                // Auto-save flow: trip already persisted. Repurpose the
                // primary action as a navigation to the saved detail view.
                <Link
                  href={`/trips/${autoSave.savedTripId}`}
                  className="bg-emerald-500 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/25 flex items-center gap-2"
                >
                  {t("result.savedViewTrip")}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              ) : autoSaveEnabled && autoSave.status === "saving" ? (
                <button
                  type="button"
                  disabled
                  className="bg-[var(--secondary-ink)] text-white px-6 py-2.5 rounded-xl font-medium opacity-60 shadow-lg shadow-[var(--secondary)]/25 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t("result.saving")}
                </button>
              ) : autoSaveEnabled && autoSave.status === "error" ? (
                <button
                  onClick={() => autoSave.retry()}
                  className="bg-rose-500 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-rose-600 transition-colors flex items-center gap-2"
                >
                  {t("result.retrySave")}
                </button>
              ) : (
                // Manual Save Trip button: auto-save is off, or has nothing
                // persisted yet (e.g. a signed-out planner).
                <button
                  onClick={handleSaveTrip}
                  disabled={loading}
                  className="bg-[var(--secondary-ink)] text-white px-6 py-2.5 rounded-xl font-medium hover:bg-[var(--secondary-ink)]/90 transition-colors disabled:opacity-50 shadow-lg shadow-[var(--secondary)]/25 flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {t("wizard.result.saving")}
                    </>
                  ) : (
                    <>
                      {t("wizard.result.saveTrip")}
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </>
                  )}
                </button>
              )}

              {/* Anonymous share: lets a signed-out planner send the trip
                  without an account. It mints an ownerless, read-only link and
                  keeps a claim token so the trip follows them into the account
                  they create.

                  isAuthenticated === false, not !isAuthenticated: the flag is
                  tri-state and `null` means still resolving. Rendering on null
                  would flash a share button at users who turn out to be signed
                  in. Also hidden once a trip is saved — at that point the
                  owner-based share flow is the right one. */}
              {isAuthenticated === false && !savedTripId && generatedItinerary && (
                <AnonymousShareButton
                  onShared={handleAnonShared}
                  onKeep={handleKeepSharedTrip}
                  mode={tripIntent === "group" ? "crew" : "share"}
                  existingShareUrl={sessionShareUrl}
                  trip={{
                    title: `${generatedItinerary.destination.name} Trip`,
                    description: generatedItinerary.destination.description,
                    destination,
                    startDate,
                    endDate,
                    itinerary: generatedItinerary.days,
                    locale: generatedItinerary.language ?? locale,
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Mobile Sticky Bottom Bar */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 px-4 py-3 sm:hidden pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          {/* Mobile save motivation — the desktop ValuePropositionBanner is
              hidden sm:block, so without this mobile gets a bare Save button
              with no "why". A compact free/benefit line at the always-visible
              save moment. Hides once the trip is saved. */}
          {!savedTripId && (
            <p className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-emerald-600">
              <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              {t("wizard.result.mobileSaveNudge", {
                count: generatedItinerary.days.length,
              })}
            </p>
          )}
          {/* Ask your crew to vote — mobile, full-width above the save row.
              Shown pre-save (the peak share-intent moment).

              A SIGNED-OUT planner gets the anonymous share button: the
              handleSaveTrip() route would put them straight into the auth
              wall the anonymous share exists to remove. Everyone else keeps
              the save route. isAuthenticated is tri-state, so only an
              explicit `false` swaps — `null` means still resolving and must not
              flash a share button at someone who turns out to be signed in. */}
          {!savedTripId && (isAuthenticated === false && generatedItinerary ? (
            <AnonymousShareButton
              onShared={handleAnonShared}
              onKeep={handleKeepSharedTrip}
              mode={tripIntent === "group" ? "crew" : "share"}
              existingShareUrl={sessionShareUrl}
              className="mb-2"
              trip={{
                title: `${generatedItinerary.destination.name} Trip`,
                description: generatedItinerary.destination.description,
                destination,
                startDate,
                endDate,
                itinerary: generatedItinerary.days,
                locale: generatedItinerary.language ?? locale,
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => handleSaveTrip()}
              className="mb-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold border border-[var(--secondary)] text-[var(--secondary-ink)] hover:bg-[var(--secondary)]/5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              {t("wizard.result.shareForVotes")}
            </button>
          ))}
          <div className="flex items-center gap-2">
            {/* Start Over - Mobile */}
            <button
              onClick={() => setShowStartOverModal(true)}
              className="flex items-center justify-center w-12 h-12 rounded-xl bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-600 transition-colors flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Regenerate - Mobile */}
            <RegenerateButton
              onRegenerate={requestRegenerate}
              isRegenerating={isRegenerating || generating}
              variant="icon-only"
              className="flex-shrink-0"
            />

            {/* Unsaved-state pill, next to the Save button. */}
            {isUnsaved && <NotSavedPill />}

            {/* Save - Mobile (Full Width) */}
            {autoSaveEnabled && autoSave.savedTripId && autoSave.status !== "saving" ? (
              <Link
                href={`/trips/${autoSave.savedTripId}`}
                className="flex-1 bg-emerald-500 text-white py-3 rounded-xl font-semibold transition-colors shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2"
              >
                {t("result.savedViewTrip")}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            ) : autoSaveEnabled && autoSave.status === "saving" ? (
              <button
                type="button"
                disabled
                className="flex-1 bg-[var(--secondary-ink)] text-white py-3 rounded-xl font-semibold opacity-60 shadow-lg shadow-[var(--secondary)]/25 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t("result.saving")}
              </button>
            ) : autoSaveEnabled && autoSave.status === "error" ? (
              <button
                onClick={() => autoSave.retry()}
                className="flex-1 bg-rose-500 text-white py-3 rounded-xl font-semibold hover:bg-rose-600 transition-colors flex items-center justify-center gap-2"
              >
                {t("result.retrySave")}
              </button>
            ) : (
              <button
                onClick={handleSaveTrip}
                disabled={loading}
                className="flex-1 bg-[var(--secondary-ink)] text-white py-3 rounded-xl font-semibold transition-colors disabled:opacity-50 shadow-lg shadow-[var(--secondary)]/25 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t("wizard.result.saving")}
                  </>
                ) : (
                  <>
                    {t("wizard.result.saveTrip")}
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Session trips tray. Sits at the top of the scrollable result
              content (directly under the sticky header) so it never disturbs
              the hero or sticky layers. Visibility gated on
              sessionTrayVisible: ≥2 stacked trips, current trip unsaved,
              auto-save arm not active. */}
          {sessionTrayVisible && (
            <SessionTripsTray
              trips={sessionTrips}
              currentId={sessionTripCurrentId}
              onRestore={handleSessionTrayRestore}
            />
          )}
          {/* Save/generation error, shown here as well as in the form view:
              without it an authed Save failure on the result looks like a
              dead button. */}
          {error && (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {error}
            </div>
          )}
          {/* AI assistant — Q&A + day-scoped edits at peak intent. */}
          <div className="mb-8">
            <AnonAssistantPanel
              destination={fullDestination}
              tripTitle={`${generatedItinerary.destination.name} Trip`}
              days={generatedItinerary.days}
              language={generatedItinerary.language}
              startDate={startDate}
              endDate={endDate}
              onApplyEdits={handleApplyAssistantEdits}
              // Post-edit save bridge. Only offered while the
              // trip is unsaved AND the manual save arm owns persistence —
              // when the auto-save arm is active the edit is already being
              // persisted, so the ask would be false.
              onRequestSave={
                isUnsaved && !autoSaveArmActive
                  ? () => {
                      void handleSaveTrip();
                    }
                  : undefined
              }
              // The deliverable half of the bridge. A share link needs no
              // account, and the "Keep this trip, free" row rides on it, so
              // the refiner can leave holding the plan instead of only being
              // asked to sign up. Signed-out and unsaved only — for everyone
              // else the owner-based share flow is the right one.
              shareSlot={
                isAuthenticated === false && !savedTripId && generatedItinerary ? (
                  <AnonymousShareButton
                    trip={{
                      title: `${generatedItinerary.destination.name} Trip`,
                      description: generatedItinerary.destination.description,
                      destination,
                      startDate,
                      endDate,
                      itinerary: generatedItinerary.days,
                      locale: generatedItinerary.language ?? locale,
                    }}
                    onShared={handleAnonShared}
                    onKeep={handleKeepSharedTrip}
                    mode={tripIntent === "group" ? "crew" : "share"}
                    existingShareUrl={sessionShareUrl}
                  />
                ) : undefined
              }
            />
          </div>

          {/* Interactive Map + View Controls */}
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">{t("wizard.result.tripOverview")}</h2>
                {/*
                  No subtitle: destination.weather_note is unsourced model prose
                  that contradicts itself across trips, and this slot reads as a
                  fact about the trip. There is no real forecast to show either —
                  the trip is not saved yet and is usually months out, beyond any
                  forecast horizon — so it states nothing rather than stating
                  something invented.
                */}
              </div>

              {/* View-mode + map toggles, for parity with
                  /trips/template/[id]. Cards is the dense rich view; Timeline
                  is a vertical-rail compact view for skim-reading. */}
              <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                <div className="hidden sm:flex items-center bg-slate-100 rounded-lg p-1">
                  <button
                    onClick={() => setResultViewMode("cards")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      resultViewMode === "cards"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {t("wizard.result.viewCards")}
                  </button>
                  <button
                    onClick={() => setResultViewMode("timeline")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      resultViewMode === "timeline"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {t("wizard.result.viewTimeline")}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowMap((v) => !v)}
                  title={showMap ? t("wizard.result.hideMap") : t("wizard.result.showMap")}
                  aria-pressed={showMap}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    showMap
                      ? "bg-[var(--primary)] text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {showMap ? t("wizard.result.hideMap") : t("wizard.result.showMap")}
                </button>
              </div>
            </div>

            {showMap && (
              <TripMap
                days={generatedItinerary.days}
                destination={fullDestination}
                className="h-[350px]"
                onActivityClick={(activity) => {
                  // Map pin click → scroll to the matching activity card. The
                  // InfoWindow "View Details" button calls this; ActivityCard
                  // exposes a stable `id` attribute we target here.
                  const slug =
                    activity.id
                      ? `activity-${activity.id}`
                      : `activity-${(activity.name || "unknown")
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .slice(0, 60)}`;
                  const el = document.getElementById(slug);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                    el.classList.add("ring-2", "ring-[var(--primary)]");
                    setTimeout(() => {
                      el.classList.remove("ring-2", "ring-[var(--primary)]");
                    }, 2000);
                  }
                }}
              />
            )}
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">{t("wizard.result.duration")}</div>
              <div className="font-semibold text-xl text-slate-900">{t("wizard.result.days", { count: generatedItinerary.days.length })}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">{t("wizard.result.estBudget")}</div>
              <div className="font-semibold text-xl text-slate-900">
                {convertCurrency(
                  generatedItinerary.trip_summary.total_estimated_cost,
                  generatedItinerary.trip_summary.currency
                ).formatted}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">{t("wizard.result.activities")}</div>
              <div className="font-semibold text-xl text-slate-900">
                {generatedItinerary.days.reduce((acc, day) => acc + day.activities.length, 0)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">{t("wizard.result.pace")}</div>
              <div className="font-semibold text-xl text-slate-900 capitalize">{pace}</div>
            </div>
          </div>

          {/* Booking Links */}
          {generatedItinerary.booking_links && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-6 mb-8">
              <h3 className="font-semibold text-amber-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t("wizard.result.bookYourTravel")}
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <div className="text-sm font-medium text-amber-800 mb-3">{t("wizard.result.flights")}</div>
                  <div className="flex flex-wrap gap-2">
                    {generatedItinerary.booking_links.flights.map((link) => (
                      <a
                        key={link.provider}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-white border border-amber-200 rounded-lg text-sm text-amber-900 hover:bg-amber-50 hover:border-amber-300 transition-colors shadow-sm"
                      >
                        {link.provider} ↗
                      </a>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-amber-800 mb-3">{t("wizard.result.hotels")}</div>
                  <div className="flex flex-wrap gap-2">
                    {generatedItinerary.booking_links.hotels.map((link) => (
                      <a
                        key={link.provider}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-white border border-amber-200 rounded-lg text-sm text-amber-900 hover:bg-amber-50 hover:border-amber-300 transition-colors shadow-sm"
                      >
                        {link.provider} ↗
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Value Proposition Banner - Positioned before schedule to encourage save */}
          <div className="mb-8 hidden sm:block">
            <ValuePropositionBanner
              onSave={handleSaveTrip}
              isSaving={loading}
              variant="inline"
            />
          </div>

          {/* Day by Day with ActivityCards */}
          <div className="space-y-8">
            {generatedItinerary.days.map((day) => (
              <div key={day.day_number} id={`day-${day.day_number}`} className="scroll-mt-24">
                {/* Day Header */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 text-white flex items-center justify-center font-bold text-lg shadow-lg">
                      {day.day_number}
                    </div>
                    <div>
                      <h2 className="font-bold text-xl text-slate-900">{t("wizard.result.dayLabel", { n: day.day_number })}</h2>
                      {day.theme && <p className="text-slate-500 text-sm">{day.theme}</p>}
                    </div>
                  </div>
                  {day.daily_budget && (
                    <div className="ml-auto text-right">
                      <div className="text-sm text-slate-500">{t("wizard.result.dailyBudget")}</div>
                      <div className="font-semibold text-slate-900">
                        {convertCurrency(
                          day.daily_budget.total,
                          generatedItinerary.trip_summary.currency
                        ).formatted}
                      </div>
                    </div>
                  )}
                </div>

                {/* Activities — Cards or Timeline view */}
                {resultViewMode === "cards" ? (
                  <div className="grid gap-4">
                    {day.activities.map((activity, idx) => (
                      // disableAutoFetch: auto-fetch pays a Text Search Pro call per
                      // expanded card. Photos load on tap here, as on the detail and
                      // shared views.
                      <ActivityCard
                        key={idx}
                        activity={activity}
                        index={idx}
                        currency={generatedItinerary.trip_summary.currency}
                        showGallery={true}
                        disableAutoFetch={true}
                      />
                    ))}
                  </div>
                ) : (
                  // Compact vertical-rail Timeline view (parity with
                  // /trips/template/[id]). Easier to skim than full Cards —
                  // no images, just time/title/location.
                  <div className="relative pl-8 border-l-2 border-slate-200 space-y-2">
                    {day.activities.map((activity, idx) => {
                      const activityDomId = activity.id
                        ? `activity-${activity.id}`
                        : `activity-${(activity.name || "unknown")
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .slice(0, 60)}`;
                      return (
                        <div
                          key={activity.id || idx}
                          id={activityDomId}
                          className="relative scroll-mt-24"
                        >
                          <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-[var(--primary)] border-4 border-white shadow" />
                          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                                  <span className="font-medium">
                                    {activity.start_time}
                                  </span>
                                  {activity.duration_minutes && (
                                    <>
                                      <span>·</span>
                                      <span>{activity.duration_minutes} min</span>
                                    </>
                                  )}
                                </div>
                                <h4 className="font-semibold text-slate-900">
                                  {activity.locked && (
                                    <span
                                      className="mr-1"
                                      title={t("wizard.anchors.lockedBadge")}
                                      aria-label={t("wizard.anchors.lockedBadge")}
                                    >
                                      📌
                                    </span>
                                  )}
                                  {activity.name}
                                </h4>
                                {activity.description && (
                                  <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                                    {activity.description}
                                  </p>
                                )}
                                {(activity.address || activity.location) && (
                                  <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-500">
                                    <svg
                                      className="w-3.5 h-3.5 shrink-0"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                                      />
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                                      />
                                    </svg>
                                    <span className="truncate">
                                      {activity.address || activity.location}
                                    </span>
                                  </div>
                                )}
                              </div>
                              {activity.estimated_cost?.amount != null && (
                                <div className="text-right shrink-0">
                                  <div className="font-medium text-slate-900 text-sm">
                                    {convertCurrency(
                                      activity.estimated_cost.amount,
                                      activity.estimated_cost.currency ||
                                        generatedItinerary.trip_summary.currency
                                    ).formatted}
                                  </div>
                                  <span className="text-xs text-slate-500 capitalize">
                                    {activity.type}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Packing Suggestions */}
          {generatedItinerary.trip_summary.packing_suggestions.length > 0 && (
            <div className="mt-10 bg-slate-50 rounded-xl p-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                {t("wizard.result.packingSuggestions")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {generatedItinerary.trip_summary.packing_suggestions.map((item) => (
                  <span key={item} className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 shadow-sm">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI Disclaimer */}
          <div className="mt-10 p-5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-amber-900 mb-1">{t("wizard.result.aiVerifiedTitle")}</h4>
                <p className="text-sm text-amber-800">{t("wizard.result.aiVerifiedBody")}</p>
              </div>
            </div>
          </div>

          {/* Simple Regenerate CTA for users who scrolled to the bottom */}
          <div className="mt-8 flex flex-col items-center gap-4 pb-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t("wizard.result.notQuiteRight")}
            </div>
            <RegenerateButton
              onRegenerate={requestRegenerate}
              isRegenerating={isRegenerating || generating}
              variant="default"
            />
          </div>
        </main>
      </div>
    );
  }

  // Generating state - use premium progress component
  if (generating) {
    return (
      <GenerationProgress
        destination={destination}
        isGenerating={generating}
        streamedDayCount={streamedDayCount}
        streamedTotalDays={streamedTotalDays}
      />
    );
  }

  // Wizard form
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <WizardReplay />
      {/* Auth Prompt Modal - for gradual engagement */}
      <AuthPromptModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        destination={destination}
        location={authPromptLocation}
        reason={authPromptReason}
        redirectPath={limitRedirectPath}
      />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href={isAuthenticated ? "/trips" : "/"}
            className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 px-2 py-1.5 -ml-2 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">{t("wizard.back")}</span>
          </Link>
          <div className="flex items-center gap-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i + 1 <= step ? "bg-[var(--primary)] w-8" : "bg-slate-200 w-4"
                }`}
              />
            ))}
          </div>
          <div className="text-sm text-slate-500">
            {step}/{TOTAL_STEPS}
          </div>
        </div>
      </header>

      {/* Form Content — extra bottom padding on mobile for sticky nav */}
      <main className="max-w-2xl mx-auto px-4 py-6 sm:py-8 pb-28 sm:pb-8">
        {/* Returning User Banner - shows on step 1 for authenticated users with trips */}
        {/* Suppressed for a fresh signup and while a claimed trip is shown: a
            claim flips hasExistingTrips to true one tick later and "Welcome
            back — you already have trips" would contradict "your trip came
            with you" for someone who created the account a minute ago. */}
        {isAuthenticated && hasExistingTrips && showReturningUserBanner && step === 1 && !claimedTripId && !isFreshSignup && (
          <div className="mb-6 p-4 bg-gradient-to-r from-[var(--primary)]/5 to-[var(--secondary)]/5 border border-[var(--primary)]/20 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-[var(--primary-ink)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900">{t("wizard.returningUser.welcomeBack")}</h3>
                <p className="text-sm text-slate-600 mt-1">
                  {t("wizard.returningUser.subtitle")}
                </p>
                <div className="flex items-center gap-3 mt-3">
                  <Link
                    href="/trips"
                    className="px-4 py-2 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary)]/90 transition-colors"
                  >
                    {t("wizard.returningUser.goToMyTrips")}
                  </Link>
                  <button
                    onClick={() => setShowReturningUserBanner(false)}
                    className="px-4 py-2 text-slate-600 text-sm font-medium hover:text-slate-900 transition-colors"
                  >
                    {t("wizard.returningUser.startNewTrip")}
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowReturningUserBanner(false)}
                className="p-1 text-slate-500 hover:text-slate-600 transition-colors"
                aria-label={t("wizard.returningUser.dismiss")}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl mb-6 p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <p className="text-red-700 font-medium">
                  {/*
                    Detect server-busy error patterns (5xx from
                    /api/ai/generate) and show a user-friendly message
                    instead of the raw "Failed to generate valid itinerary
                    after retries" / "AI service unavailable" string. These
                    error strings can leak when the upstream Gemini API is
                    rate-limited, the key is revoked, or any other 5xx fires
                    after the retry budget is exhausted — none of which the
                    user can act on. The friendly message + retry button
                    gives them a concrete next step.
                  */}
                  {error.includes("timed out")
                    ? t("generation.errorTimeout")
                    : error.includes("fetch") || error.includes("network") || error.includes("Failed to fetch")
                    ? t("generation.errorNetwork")
                    : error.includes("AI service") ||
                      error.includes("after retries") ||
                      error.includes("Internal server error") ||
                      error.includes("Failed to generate") ||
                      error.includes("503") ||
                      error.includes("500")
                    ? t("generation.errorServerBusy")
                    : error}
                </p>
                <button
                  onClick={() => { setError(null); handleGenerate(); }}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {t("generation.retry")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Destination + Dates (combined for fewer drop-offs).
            Layout uses flex+order so the PRIMARY inputs (Destination + Dates)
            lead, and the optional sections (Backpacker / Who's-coming, each
            marked order-last) fall below them. This is the highest-abandon
            screen: required inputs buried under optional cards would also sit
            under the first-visit cookie banner. */}
        {step === 1 && (
          <div className="flex flex-col gap-6">
            {/* The trip a signup claimed — above draft recovery (a finished
                trip outranks an unsaved one), above the masthead. Not
                flag-gated: without it a claimed trip is a dead end. */}
            {claimedTripId && (
              <ClaimedTripBanner
                tripId={claimedTripId}
                onOpen={() => dismissClaimedTrip("opened")}
                onPlanAnother={() => dismissClaimedTrip("plan_another")}
                onDismiss={() => dismissClaimedTrip("dismissed")}
              />
            )}
            {showPendingClaimBanner && pendingClaim && (
              <PendingClaimBanner
                pending={pendingClaim}
                onKeep={() => handlePendingClaimAction("keep")}
                onOpenLink={() => handlePendingClaimAction("open_link")}
                onDismiss={() => handlePendingClaimAction("dismissed")}
              />
            )}
            {/* Returning-visitor draft recovery. A valid unsaved draft exists
                within the draft TTL (useItineraryDraft) — the banner lets the
                user recover straight into the Save moment instead of
                re-running the wizard and burning another scarce anon
                generation. */}
            {/* A draft that aged out. useItineraryDraft deletes it on read and
                returns isExpired; say so once, plainly, rather than let the
                plan disappear without a word. */}
            {isExpired && !draft && !generatedItinerary && (
              <p className="mb-2 text-sm text-slate-600" role="status" data-draft-expired>
                {t("wizard.draftRecovery.expired")}
              </p>
            )}
            {showDraftRecovery && draft && (
              <DraftRecoveryBanner
                draft={draft}
                onRestore={handleRestoreDraft}
                onDiscard={handleDiscardDraft}
              />
            )}
            <WizardMasthead
              variant={mastheadVariant}
              destination={prefilledDestination?.name ?? searchParams?.get("destination") ?? null}
              plannedStat={plannedStat}
              locale={locale}
            />

            {/* Backpacker Mode toggle, shown only while the mode is already
                active: few sessions use it, and on the highest-abandon screen
                it would be the biggest block. The mode arrives with a restored
                draft or session-tray snapshot; here it can be switched off. */}
            {travelStyle === "backpacker" && (
            <div className="order-last">
              <button
                type="button"
                onClick={() => setTravelStyle("classic")}
                aria-pressed={travelStyle === "backpacker"}
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                  travelStyle === "backpacker"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden>🎒</span>
                  <span>
                    {travelStyle === "backpacker"
                      ? t("wizard.step1.backpackerModeOn")
                      : t("wizard.step1.backpackerMode")}
                  </span>
                </span>
                <span className="text-xs opacity-80">
                  {travelStyle === "backpacker"
                    ? "Hostels · Budget · Social"
                    : t("wizard.step1.backpackerModeSubtitle")}
                </span>
              </button>
              {travelStyle === "backpacker" && (
                <p className="text-xs text-emerald-700 mt-2 pl-1">
                  We&rsquo;ll favour hostels, free walking tours, street food,
                  and public transit. Budget tier set to &quot;budget&quot; — you
                  can change it in the next step.
                </p>
              )}
            </div>
            )}

            {/* Who's coming? — captures whether the user is planning solo or
                with friends, the evidence for the group-vs-solo decision.
                Group also shows the invite hint below and puts the anonymous
                share button in crew mode. Option labels come from messages so
                every locale gets localized copy. */}
            <div className="order-last">
              <div className="text-sm font-medium text-slate-700 mb-2">
                {t("wizard.step1.whosComing")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: "solo", labelKey: "wizard.step1.justMe", emoji: "👤" },
                    { value: "group", labelKey: "wizard.step1.withFriends", emoji: "👥" },
                  ] as const
                ).map((opt) => {
                  const isSelected = tripIntent === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        const changed =
                          tripIntent !== "unspecified" &&
                          tripIntent !== opt.value;
                        setTripIntent(opt.value);
                        captureTripIntentSelected({
                          intent: opt.value,
                          changed,
                        });
                      }}
                      // Selected state: /10 fill + primary-colored text, a
                      // clear "this is picked" affordance (a /5 fill is
                      // barely visible).
                      className={`relative flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                        isSelected
                          ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-ink)]"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                      aria-pressed={isSelected}
                    >
                      {/* The emoji is dimmed (opacity-70) when unselected. */}
                      <span
                        className={`text-lg ${isSelected ? "" : "opacity-70"}`}
                        aria-hidden
                      >
                        {opt.emoji}
                      </span>
                      <span>{t(opt.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
              {tripIntent === "group" && (
                <p className="text-xs text-slate-500 mt-2">
                  {/* Say what happens next, never "coming soon":
                      invite-after-generation already works. */}
                  You&rsquo;ll be able to invite friends to vote after we
                  generate the trip.
                </p>
              )}
            </div>

            {/* 12+-day single-city sessions are usually multi-city trips the
                input didn't invite. One tap converts them. */}
            {MULTI_CITY_ENABLED &&
              !multiCityMode &&
              startDate &&
              endDate &&
              tripSpanDaysInclusive(startDate, endDate) >= 12 && (
                <button
                  type="button"
                  onClick={() => setMultiCityMode(true)}
                  className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                >
                  {t("wizard.multiCity.longTripNudge", {
                    days: tripSpanDaysInclusive(startDate, endDate),
                  })}
                </button>
              )}

            {/* Multi-city route builder — replaces the single destination field */}
            {MULTI_CITY_ENABLED && multiCityMode && (
              <div>
                <div className="text-sm font-medium text-slate-700 mb-2">
                  {t("wizard.multiCity.routeLabel")}
                </div>
                <MultiCityRouteBuilder rows={cityRows} onChange={setCityRows} />
              </div>
            )}

            {/* Destination (single-city; hidden in multi-city mode) */}
            <div className={multiCityMode ? "hidden" : undefined}>
              <div
                id="wizard-destination-label"
                className="text-sm font-medium text-slate-700 mb-2"
              >
                {t("wizard.step1.destinationLabel")}
              </div>
              <DestinationAutocomplete
                value={destination}
                onChange={(v) => {
                  trackFieldInteraction("destination_autocomplete");
                  setDestination(v);
                }}
                onSelect={(p) => {
                  trackFieldInteraction("destination_autocomplete");
                  handleDestinationSelect(p);
                }}
                placeholder={t("wizard.step1.placeholder")}
                // A11y: wire visible "Destination" header to the
                // <input> so screen readers announce "Destination, edit" with
                // context instead of bare "edit". aria-required reflects that
                // this is a required wizard field.
                ariaLabelledBy="wizard-destination-label"
                ariaRequired
                // No autoFocus: on mobile it auto-opens the suggestions
                // dropdown over the popular-destination pills below, so a tap
                // meant for a pill lands on a suggestion. Users can still tap
                // the input to reveal the autocomplete dropdown.
              />

              {/* Inline allowlist warning — same character set the server
                  enforces (lib/gemini.ts DESTINATION_ALLOWLIST). Shown the
                  moment the input goes invalid instead of letting the user
                  fill the whole form and fail at generate. */}
              {destination.length >= 2 && !DESTINATION_ALLOWLIST.test(destination) && (
                <p role="alert" className="mt-2 text-xs font-medium text-red-600">
                  {t("wizard.step1.destinationInvalidChars")}
                </p>
              )}

              {/* Too long is the other half of the same server rule.
                  Deliberately NOT a maxLength on the input: silent truncation
                  would pass both the allowlist and the bound, and generate a
                  confident itinerary for whatever the first 100 characters
                  happened to spell. */}
              {destination.length > DESTINATION_MAX_LENGTH && (
                <p role="alert" className="mt-2 text-xs font-medium text-red-600">
                  {t("wizard.step1.destinationTooLong")}
                </p>
              )}

              {/* Popular destinations — real demand-ranked (distinct planning
                  sessions), season-reordered. */}
              {!destination && (
                <OneTapStarts
                  picks={popularPicks}
                  inSeasonMonth={inSeasonMonth}
                  onPick={handleOneTapStart}
                />
              )}
            </div>

            {/* Multi-city toggle — gated by NEXT_PUBLIC_MULTI_CITY_ENABLED.
                Sits directly after the destination block in both states, so
                an advanced option never leads the form: when on, the route
                builder above replaces the destination field, so the switch
                stays adjacent to what it controls. The ?multi=1 deep link and
                the sync effect key off state, not DOM position. */}
            {MULTI_CITY_ENABLED && (
              <div
                className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--primary)]/15 bg-[var(--background-warm)] px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    {t("wizard.multiCity.toggleTitle")}
                  </div>
                  <div className="text-xs text-slate-500">
                    {t("wizard.multiCity.toggleDescription")}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={multiCityMode}
                  aria-label={t("wizard.multiCity.toggleAria")}
                  onClick={() => setMultiCityMode((m) => !m)}
                  className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors ${
                    multiCityMode ? "bg-[var(--primary)]" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      multiCityMode ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Dates — shown immediately below destination */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-2">{t("wizard.step1.travelDatesLabel")}</div>
              {MULTI_CITY_ENABLED && multiCityMode ? (
                // Multi-city: trip length = sum of per-city nights, so only the
                // START date is a free choice; the end is derived (sync effect).
                <div>
                  <input
                    type="date"
                    value={startDate}
                    min={new Date().toISOString().split("T")[0]}
                    // Bounded on BOTH ends. Without a max, a typed year of
                    // "20220" is a perfectly acceptable <input type="date">
                    // value (the spec allows years to 275760), and in
                    // multi-city generation addDaysISO throws on it
                    // ("invalid date"): ISO 8601 needs a sign for extended
                    // years (+020220-05-01), so new Date() returns NaN.
                    max={MAX_TRIP_START_DATE}
                    onChange={(e) => {
                      trackFieldInteraction("start_date");
                      // max alone is not enough: Chrome still reports an
                      // out-of-range-but-parseable date through .value. Accept
                      // only a real YYYY-MM-DD, so a malformed year can never
                      // reach the itinerary maths.
                      setStartDate(sanitizeIsoDate(e.target.value));
                    }}
                    aria-label="Trip start date"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    {cityRows.reduce((s, r) => s + (Number(r.nights) || 0), 0)} nights total across your cities
                    {endDate ? ` · ends ${endDate}` : ""}
                  </p>
                </div>
              ) : (
                <DateRangePicker
                  startDate={startDate}
                  endDate={endDate}
                  triggerRef={dateTriggerRef}
                  onStartDateChange={(d) => {
                    trackFieldInteraction("start_date");
                    setFlexibleDates(false);
                    setDatesPencilled(false);
                    setStartDate(d);
                  }}
                  onEndDateChange={(d) => {
                    trackFieldInteraction("end_date");
                    setFlexibleDates(false);
                    setDatesPencilled(false);
                    setEndDate(d);
                  }}
                  maxDays={effectiveMaxTripDays}
                  minDate={new Date().toISOString().split("T")[0]}
                  // A11y: dates required to advance the wizard.
                  ariaRequired
                />
              )}

              {/* "I'm flexible" escape hatch — dates are a hard gate to advance,
                  but many visitors know WHERE, not WHEN. One tap fills a sensible
                  default (~3 weeks out, 5 days) so they can reach a generated trip
                  and fine-tune later. Hidden in multi-city mode (per-city nights
                  model owns dates there). */}
              {!(MULTI_CITY_ENABLED && multiCityMode) && (
                <div className="mt-2">
                  {flexibleDates ? (
                    datesPencilled ? (
                      // Announced, not just shown: the one-tap moved focus here
                      // and this is the sentence that explains what it assumed.
                      // slate-600, not coral — --primary-ink is 2.68:1.
                      <p aria-live="polite" className="flex items-center gap-1.5 text-xs text-slate-600">
                        <svg className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {t("wizard.step1.oneTap.datesPencilled", { days: 5 })}
                      </p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary-ink)]">
                        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {t("wizard.step1.flexibleDatesActive")}
                      </p>
                    )
                  ) : (
                    !(startDate && endDate) && (
                      <button
                        type="button"
                        onClick={handleFlexibleDates}
                        className="text-xs font-medium text-[var(--primary-ink)] underline-offset-2 hover:underline"
                      >
                        {t("wizard.step1.flexibleDatesCta")}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            {/* Anchored trips: "I have fixed plans" — collapsed by default
                to a single small text link (step-1→2 conversion is the fragile
                guardrail metric). Needs dates (anchors are date-specific);
                hidden in multi-city mode (mirrors the API guard). */}
            {!(MULTI_CITY_ENABLED && multiCityMode) && startDate && endDate && (
              <AnchorEditor
                anchors={anchors}
                onChange={setAnchors}
                startDate={startDate}
                endDate={endDate}
                destination={destination}
                // Pasted items with no day can't be anchors, but they're still
                // the user's plan — fold them into the free-text requirements
                // so generation still honours them.
                onImportUndated={(items) =>
                  setRequirements((prev) => {
                    const addition = items.join(". ");
                    const merged = prev.trim() ? `${prev.trim()}. ${addition}` : addition;
                    // validateTripParams rejects >500 chars with a bare 400,
                    // and the textarea lives in a collapsed section, so an
                    // unclamped big paste would make generate fail on repeat
                    // with the overflow out of sight.
                    return merged.slice(0, REQUIREMENTS_MAX);
                  })
                }
              />
            )}

            {/* Seasonal Context Card - Auto-displays when both are set */}
            {destination && startDate && endDate && (
              <SeasonalContextCard
                destination={destination}
                startDate={startDate}
                endDate={endDate}
                coordinates={destinationCoords || undefined}
              />
            )}
          </div>
        )}

        {/* Step 2: Vibes + Optional Preferences (combined) */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1 sm:mb-2">
                {t("wizard.step2.title")}
              </h1>
              <p className="text-slate-600">
                {t("wizard.step2.subtitle", { destination })}
              </p>
            </div>

            {/* Vibes — required.
                onVibesChange uses the memoized handleVibesChange from
                above so the VibeSelector's React.memo can short-circuit
                on parent re-renders. */}
            <VibeSelector
              selectedVibes={selectedVibes}
              onVibesChange={handleVibesChange}
              maxVibes={3}
            />

            {/* Must-do wishlist — visible, first-class, on step 2 ON
                PURPOSE: step 1 is the fragile funnel gate, step 2 is past
                it. Undated wishes, unlike the date-pinned anchors. */}
            <div>
              <label htmlFor="must-do-input" className="block text-sm font-medium text-slate-700 mb-1">
                {t("wizard.step2.mustDos.title")}{" "}
                <span className="font-normal text-slate-500">{t("wizard.step2.mustDos.optional")}</span>
              </label>
              <p className="text-xs text-slate-500 mb-2">{t("wizard.step2.mustDos.hint")}</p>
              {mustDos.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {mustDos.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/10 px-3 py-1.5 text-sm font-medium text-[var(--primary-ink)]"
                    >
                      {item}
                      <button
                        type="button"
                        onClick={() => setMustDos((prev) => prev.filter((m) => m !== item))}
                        aria-label={t("wizard.step2.mustDos.remove", { item })}
                        className="text-[var(--primary-ink)]/60 hover:text-[var(--primary-ink)] min-h-[24px] min-w-[24px]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {mustDos.length < 10 && (
                <input
                  id="must-do-input"
                  type="text"
                  value={mustDoInput}
                  maxLength={80}
                  onChange={(e) => setMustDoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      const item = mustDoInput.trim().replace(/,+$/, "");
                      if (!item) return;
                      setMustDos((prev) =>
                        prev.some((m) => m.toLowerCase() === item.toLowerCase()) || prev.length >= 10
                          ? prev
                          : [...prev, item]
                      );
                      setMustDoInput("");
                    }
                  }}
                  onBlur={() => {
                    // Don't lose a typed-but-unconfirmed wish on tap-away (mobile).
                    const item = mustDoInput.trim().replace(/,+$/, "");
                    if (!item) return;
                    setMustDos((prev) =>
                      prev.some((m) => m.toLowerCase() === item.toLowerCase()) || prev.length >= 10
                        ? prev
                        : [...prev, item]
                    );
                    setMustDoInput("");
                  }}
                  placeholder={t("wizard.step2.mustDos.placeholder")}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors text-sm"
                />
              )}
            </div>

            {/* Collapsible Advanced Preferences */}
            <div className="border-t border-slate-200 pt-4">
              <button
                onClick={() => setShowAdvancedPrefs(!showAdvancedPrefs)}
                className="flex items-center justify-between w-full text-left py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors min-h-[44px]"
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  {t("wizard.step2.customize")}
                  {!showAdvancedPrefs && (
                    <span className="text-xs text-slate-500 font-normal">(defaults: Balanced budget, Moderate pace)</span>
                  )}
                </span>
                <svg className={`w-5 h-5 transition-transform ${showAdvancedPrefs ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showAdvancedPrefs && (
                <div className="space-y-6 mt-4 animate-in slide-in-from-top-2">
                  {/* Budget */}
                  <div>
                    <div className="text-sm font-medium text-slate-700 mb-3">{t("budget.title")}</div>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {BUDGET_TIER_IDS.map((tierId) => {
                        const styles = BUDGET_TIER_STYLES[tierId];
                        return (
                          <button
                            key={tierId}
                            onClick={() => setBudgetTier(tierId)}
                            className={`p-3 sm:p-4 rounded-xl border-2 text-center sm:text-left transition-all min-h-[48px] ${
                              budgetTier === tierId
                                ? `${styles.borderColor} ${styles.bgColor}`
                                : "border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            <div className={`font-semibold text-sm sm:text-base ${styles.color}`}>{t(`budget.${tierId}.label`)}</div>
                            <div className="text-xs text-slate-500 mt-0.5 hidden sm:block">{t(`budget.${tierId}.range`)}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pace */}
                  <div>
                    <div className="text-sm font-medium text-slate-700 mb-3">{t("pace.title")}</div>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {PACE_OPTION_IDS.map((paceId) => (
                        <button
                          key={paceId}
                          onClick={() => setPace(paceId)}
                          className={`p-3 sm:p-4 rounded-xl border-2 text-center sm:text-left transition-all min-h-[48px] ${
                            pace === paceId
                              ? "border-[var(--primary)] bg-[var(--primary)]/5"
                              : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <div className="font-semibold text-sm sm:text-base text-slate-900">{t(`pace.${paceId}.label`)}</div>
                          <div className="text-xs text-slate-500 mt-0.5 hidden sm:block">{t(`pace.${paceId}.description`)}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Special Requirements */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t("requirements.title")} <span className="font-normal text-slate-500">({t("requirements.hint").split(" - ")[0]})</span>
                    </label>
                    <textarea
                      value={requirements}
                      onChange={(e) => setRequirements(e.target.value.slice(0, REQUIREMENTS_MAX))}
                      placeholder={t("requirements.placeholder")}
                      rows={2}
                      maxLength={REQUIREMENTS_MAX}
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors resize-none text-sm"
                    />
                    {requirements.length > REQUIREMENTS_MAX - 100 && (
                      <p className="mt-1 text-xs text-slate-500 text-right">
                        {requirements.length}/{REQUIREMENTS_MAX}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation — sticky on mobile so users always see the CTA */}
        <div
          ref={footerRef}
          className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 px-4 py-3 sm:relative sm:bg-transparent sm:border-t-slate-200 sm:px-0 sm:py-0 sm:mt-8 sm:pt-6 sm:z-auto"
        >
          {/* Missing-field hint — directly attacks the step-1 cliff: the
              Continue button is disabled with no visible reason, so users
              who don't realize what unlocks it just leave. Name the first
              blocker so the path forward is always obvious. */}
          {step === 1 && !canProceed() && (
            <p aria-live="polite" className="mb-2 text-center text-xs font-medium text-slate-500 sm:text-left">
              {footerStateB
                ? t("wizard.step1.hintFlexibleDefault", { days: 5 })
                : destination.length < 2
                ? t("wizard.step1.hintNeedDestination")
                : destination.length > DESTINATION_MAX_LENGTH
                ? t("wizard.step1.destinationTooLong")
                : !DESTINATION_ALLOWLIST.test(destination)
                ? t("wizard.step1.destinationInvalidChars")
                : tripSpanDaysInclusive(startDate, endDate) > effectiveMaxTripDays
                ? t("wizard.datePicker.maxDaysLimit", { days: effectiveMaxTripDays })
                : t("wizard.step1.hintNeedDates")}
            </p>
          )}
          {/* Once step 1 is complete, the hint slot frees up — reinforce the
              free/no-signup value right at the Continue commitment point. The
              auth wall sits at Save (not Generate), so many users don't realize
              they'll see the whole trip for free first; saying so here lowers
              the "is this going to make me sign up?" hesitation. */}
          {step === 1 && canProceed() && (
            <p className="mb-2 flex items-center justify-center gap-1.5 text-center text-xs font-medium text-emerald-600 sm:justify-start sm:text-left">
              <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              {isAuthenticated
                ? t("wizard.step1.freeReassuranceSignedIn")
                : t("wizard.step1.freeReassurance")}
            </p>
          )}
          <div className="flex items-center justify-between">
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-2 px-4 py-3 sm:py-2.5 text-slate-600 hover:text-slate-900 font-medium rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors min-h-[44px]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">{t("wizard.back")}</span>
            </button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS ? (
            footerStateB ? (
              // State B: a valid destination, no dates. The same slot, the
              // same coral, an ENABLED button — one tap pencils in the
              // flexible default and the slot re-renders as Continue.
              <button
                type="button"
                onClick={() => {
                  handleFlexibleDates();
                  setDatesPencilled(true);
                }}
                className="bg-[var(--primary)] text-white px-8 py-3.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 active:bg-[var(--primary)]/80 transition-colors min-h-[48px] sm:min-h-0"
              >
                {t("wizard.step1.useFlexibleDates")}
              </button>
            ) : (
            <button
              data-testid="wizard-continue"
              onClick={() => {
                captureTripWizardStepCompleted({
                  step_number: step,
                  step_name: STEP_NAMES_CONST[step - 1],
                  ...(step === 1
                    ? { dates_mode: flexibleDates ? "flexible" : "exact", one_tap: datesPencilled }
                    : {}),
                });
                // Pre-apply seasonal vibe suggestions when advancing into
                // step 2, so the user doesn't have to re-pick by hand what
                // step 1 suggested. Only seeds if the user hasn't already
                // picked vibes (don't clobber their choices).
                if (
                  step === 1 &&
                  seasonalContext &&
                  selectedVibes.length === 0 &&
                  startDate
                ) {
                  try {
                    const month = new Date(startDate).getMonth() + 1; // 1-12
                    const suggestions = getSeasonalVibeSuggestions(
                      seasonalContext.season,
                      seasonalContext.holidays || [],
                      month
                    );
                    // Take the top 2 suggestions so the user lands in
                    // the "good defaults" state but still has room to
                    // add a 3rd of their own. Filter to the 6 canonical
                    // TripVibe values — the helper sometimes returns
                    // niche vibes like "fairytale" that the wizard's
                    // VibeSelector doesn't show.
                    const CANONICAL: TripVibe[] = [
                      "adventure",
                      "cultural",
                      "foodie",
                      "romantic",
                      "nature",
                      "urban",
                    ];
                    const validVibes = suggestions
                      .map((s) => s.vibeId as TripVibe)
                      .filter((v): v is TripVibe => CANONICAL.includes(v))
                      .slice(0, 2);
                    if (validVibes.length > 0) {
                      setSelectedVibes(validVibes);
                    }
                  } catch (err) {
                    // Non-fatal: if the helper throws, step 2 just
                    // starts empty.
                    console.warn("[wizard] seasonal vibe seed failed:", err);
                  }
                }
                setStep(step + 1);
              }}
              disabled={!canProceed()}
              className="bg-[var(--primary)] text-white px-8 py-3.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 active:bg-[var(--primary)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] sm:min-h-0"
            >
              {t("wizard.step1.continue")} →
            </button>
            )
          ) : (
            <button
              onClick={() => void handleGenerate()}
              disabled={!canProceed()}
              className="bg-[var(--accent)] text-slate-900 px-8 py-3.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--accent)]/90 active:bg-[var(--accent)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-h-[48px] sm:min-h-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {t("wizard.step2.generate")}
            </button>
          )}
          </div>
        </div>
      </main>

      {/*
        No MobileBottomNav here: it sits at fixed bottom-0 / z-50 on mobile
        and would cover the wizard's own sticky Continue/Generate button
        (z-40), making step 2 unreachable on mobile.

        The wizard is a focused flow: the user is already on /trips/new
        (so the "New" tab in MobileBottomNav points to themselves), and
        the global Navbar at the top provides the navigation paths. The
        result view doesn't render MobileBottomNav either — same pattern.
      */}
    </div>
  );
}
