"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { maxTripStartDate, addIsoDaysOrThrow } from "@/lib/dates/iso-date";
import { formatDateRange } from "@/lib/datetime";
import { localTodayISO } from "@/lib/utils/date-local";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/lib/i18n/routing";
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
  budget: BudgetTier | null;
  vibes: string[];
  /** Places to keep, from Check my plan's "fix it". */
  mustDos: string[];
}
import { useAuth } from "@/components/auth/AuthProvider";
import type { GeneratedItinerary, TripAnchor, TripStay, TripVibe, SeasonalContext, BudgetTier, TripPace } from "@/types";
import type { Diet } from "@/lib/trips/diet";
// Step-1 components (above-the-fold) stay eager.
import SeasonalContextCard from "@/components/trip/SeasonalContextCard";
import type { PlacePrediction } from "@/components/ui/DestinationAutocomplete";
import { isTripSentence, looksLikeRequest, matchesPlace, pencilledDates, readTripSentence } from "@/lib/wizard/trip-sentence";
import { fetchReading, fillOf } from "@/lib/wizard/request-reading";
import AnchorEditor from "@/components/trip/AnchorEditor";
import StayField from "@/components/wizard/StayField";
import { stayFarFrom } from "@/lib/trips/stay";
import { buildSeasonalContext } from "@/lib/seasonal";
import { generateWithRecovery } from "@/lib/wizard/generation-recovery";
import { attemptGeneration } from "@/lib/wizard/generation-attempt";
import { JourneyRibbon } from "@/components/trips/JourneyRibbon";
import { buildJourneyStops } from "@/lib/ai/transfer-legs";

// Multi-city planning (docs/MULTI_CITY_PLAN.md §2.5/§3.2). Env-gated so the
// single-city funnel is unchanged while the flag is off.
const MULTI_CITY_ENABLED = process.env.NEXT_PUBLIC_MULTI_CITY_ENABLED === "true";

// Post-generation and modal UI depends on user action or state, so it is split
// out of the initial wizard chunk to make the form paint faster. Those chunks
// would then land after the itinerary renders and pop in from zero height,
// shifting the page. Two defences, in order:
//   1. preloadResultViewChunks() fetches them during generation so they are
//      already warm when the result renders (the real fix);
//   2. the two that dominate the shift carry a correctly sized `loading` box,
//      so a slow network degrades to a skeleton instead of a jump: the hero's
//      below, and the activity card's (components/wizard/ResultItinerary.tsx).
// Heights are measured off the live components, not guessed:
//   hero  — the image box (h-64 md:h-80 lg:h-96 in DestinationHero), the tag
//           chips hanging off its bottom edge, and from sm the gallery row the
//           hero reserves while it fetches (thumbnail minus its -mt-6)
// Re-measure before touching it: a placeholder of the WRONG height creates a
// shift instead of preventing one.
const HeroSkeleton = () => (
  <div aria-hidden="true">
    <div className="h-64 md:h-80 lg:h-96 w-full bg-slate-100 animate-pulse" />
    <div className="h-5" />
    <div className="hidden sm:block sm:h-10 md:h-14" />
  </div>
);
const DestinationHero = dynamic(() => import("@/components/DestinationHero"), {
  ssr: false,
  loading: () => <HeroSkeleton />,
});
const GenerationProgress = dynamic(() => import("@/components/trip/GenerationProgress"), { ssr: false });
const StartOverModal = dynamic(() => import("@/components/trip/StartOverModal"), { ssr: false });
const ChangeDatesModal = dynamic(() => import("@/components/trip/ChangeDatesModal"), { ssr: false });
const RegenerateButton = dynamic(() => import("@/components/trip/RegenerateButton"), { ssr: false });
// AI Q&A and day-scoped edits on the wizard's result view.
const AnonAssistantPanel = dynamic(() => import("@/components/trip/AnonAssistantPanel"), { ssr: false });
// Session trips tray: result-view only, so it is code-split like the rest of
// the post-generation UI.
const SessionTripsTray = dynamic(() => import("@/components/trip/SessionTripsTray"), { ssr: false });
const AuthPromptModal = dynamic(() => import("@/components/ui/AuthPromptModal"), { ssr: false });
// Share button for signed-out planners only, so it stays out of the bundle for
// signed-in users. The placeholder is the button's height so the mobile save
// bar does not grow when it lands.
const AnonymousShareButton = dynamic(
  () => import("@/components/trip/AnonymousShareButton"),
  { ssr: false, loading: () => <div className="h-11" aria-hidden="true" /> }
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
// The warmed modules themselves. Rendered directly they skip the lazy
// boundary's fallback frame, which for a box without a sized placeholder is
// a layout shift at the moment the result appears.
let warmedAssistantPanel: (typeof import("@/components/trip/AnonAssistantPanel"))["default"] | null = null;
let warmedShareButton: (typeof import("@/components/trip/AnonymousShareButton"))["default"] | null = null;
let warmedRegenerateButton: (typeof import("@/components/trip/RegenerateButton"))["default"] | null = null;

function preloadResultViewChunks(): void {
  const warm = (p: Promise<unknown>) => {
    p.catch(() => {});
  };
  warm(import("@/components/DestinationHero"));
  warm(import("@/components/ActivityCard"));
  warm(import("@/components/TripMap"));
  warm(import("@/components/trip/AnonAssistantPanel").then((m) => { warmedAssistantPanel = m.default; }));
  warm(import("@/components/trip/RegenerateButton").then((m) => { warmedRegenerateButton = m.default; }));
  warm(import("@/components/trip/ValuePropositionBanner"));
  warm(import("@/components/trip/ExportMenu"));
  warm(import("@/components/trip/AnonymousShareButton").then((m) => { warmedShareButton = m.default; }));
}
import { useItineraryDraft } from "@/hooks/useItineraryDraft";
import { useDebounce } from "@/hooks/useDebounce";
import { useDraftRestore } from "@/hooks/useDraftRestore";
import { useGeneratedPlan } from "@/hooks/useGeneratedPlan";
import { useKeptPlan } from "@/hooks/useKeptPlan";
import { useKeptPlanOpening } from "@/hooks/useKeptPlanOpening";
import { usePlanPhotos } from "@/hooks/usePlanPhotos";
import type { KeptPlan } from "@/lib/plans/kept-plan";
// Step-1 editorial entry; see lib/wizard/entry-state.ts for the arrival model.
import WizardMasthead from "@/components/wizard/WizardMasthead";
import type { OneTapPlace } from "@/components/wizard/OneTapStarts";
import { useCssVarHeight } from "@/hooks/useCssVarHeight";
import {
  deriveEntryState,
  isFirstRunAuthEvent,
  pickMastheadVariant,
} from "@/lib/wizard/entry-state";
import {
  type AuthPromptLocation,
  captureRefineSuggestionClicked,
  captureWizardFirstRunViewed,
  captureWizardOneTapStart,
} from "@/lib/posthog/events";
import { destinationProblem, STEP1_HINT, step1Blocker } from "@/lib/wizard/step1-gate";
import { DESTINATION_MAX_LENGTH, MAX_TRIP_DAYS, MAX_TRIP_DAYS_MULTI } from "@/lib/trips/request-limits";
import {
  reportGenerated,
  reportGenerationAsks,
  reportGenerationFailed,
  reportGenerationStarted,
  type GenerationReport,
} from "@/lib/wizard/generation-reports";
import { applyAnswers, applySessionTrip, type DraftTargets } from "@/lib/wizard/apply-draft";
import { FRESH_ANSWERS, keptPlanOf, sessionTripOf, withNote, withUndatedItems, type WizardAnswers } from "@/lib/wizard/answers";
import { generationRequest, routeLegs } from "@/lib/wizard/generation-request";
import {
  classifyGenerationFailure,
  validationFix,
  validationFixStep,
} from "@/lib/wizard/generation-failure";
// Session generation counter + per-session trip stack.
import { useSessionTripStack } from "@/hooks/useSessionTripStack";
import { useCurrency } from "@/lib/locale";
import { trackDestinationSelected } from "@/lib/analytics";
import { captureTripWizardStepCompleted } from "@/lib/posthog/events";
import type { TripIntent } from "@/lib/posthog/events";
import { capture } from "@/lib/posthog/events";
import { usePostHog } from "@/lib/posthog";
import { onPostHogReady } from "@/lib/posthog/client";
import { trackWizardEvent } from "@/components/wizard/wizardEvents";
import { useWizardSave } from "@/hooks/useWizardSave";
import { useClaimedTrip } from "@/hooks/useClaimedTrip";
import { usePendingClaim } from "@/hooks/usePendingClaim";
import { useUnsavedPlan } from "@/hooks/useUnsavedPlan";
import { useAssistantEdits } from "@/hooks/useAssistantEdits";
import { useChangeDates } from "@/hooks/useChangeDates";
import { useWizardFunnel, WIZARD_STEP_NAMES } from "@/hooks/useWizardFunnel";
import { useGenerationLeft } from "@/hooks/useGenerationLeft";
import { useGenerationProgress } from "@/hooks/useGenerationProgress";
import { useHasExistingTrips } from "@/hooks/useHasExistingTrips";
import { isSameDestination } from "@/lib/trips/sameDestination";
import { shouldAutoSave } from "@/lib/trips/autoSaveGate";
import { useSameTripCheck } from "@/hooks/useSameTripCheck";
import SameTripPrompt from "@/components/wizard/SameTripPrompt";
import ResultActionBars from "@/components/wizard/ResultActionBars";
import ResultItinerary, { MAP_SECTION_ID, ResultOverview } from "@/components/wizard/ResultItinerary";
import SkyPlan from "@/components/sky/SkyPlan";
import { assignSky, syncSkyArm, type SkyAssignment } from "@/lib/experiments/result-sky";
import PreferencesStep from "@/components/wizard/PreferencesStep";
import WizardFooter from "@/components/wizard/WizardFooter";
import DestinationField from "@/components/wizard/DestinationField";
import TripDatesField from "@/components/wizard/TripDatesField";
import TripOptions from "@/components/wizard/TripOptions";
import Step1Notices from "@/components/wizard/Step1Notices";
import { MultiCityRoute, MultiCityToggle } from "@/components/wizard/MultiCityControls";
import WizardHeader from "@/components/wizard/WizardHeader";
import ReturningUserBanner from "@/components/wizard/ReturningUserBanner";
import GenerationErrorNotice from "@/components/wizard/GenerationErrorNotice";
import RegenerateConfirmModal from "@/components/wizard/RegenerateConfirmModal";
import ResultDatesNotice from "@/components/wizard/ResultDatesNotice";
import { anonymousShare } from "@/lib/wizard/anonymous-share";
import { seasonalVibeSeed } from "@/lib/wizard/seasonal-vibes";
import { newTripTitle } from "@/lib/trips/title";
import AiDisclaimer from "@/components/trip/AiDisclaimer";
import { useTravelDistances } from "@/hooks/useTravelDistances";
import { useMultiCityRoute } from "@/hooks/useMultiCityRoute";
import { isChosenTripIntent } from "@/lib/wizard/answers";

// Upper bound for the wizard start date (see lib/dates/iso-date.ts).
const MAX_TRIP_START_DATE = maxTripStartDate();

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

// Free-text ?destination= fallback (page.tsx resolves known slugs): capitalized,
// coords filled in by autocomplete on confirm.
/** Where a link that fills in the trip's shape came from. */
const prefillSource = (from: string | null | undefined) => (from === "trip" || from === "check" || from === "match" ? from : "article");

function capitalizeFreeText(param: string | null | undefined): string {
  const trimmed = (param ?? "").trim().slice(0, 120);
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "";
}

// Vibes for a one-sentence plan that names none: generation needs at least one.
const EXPRESS_VIBES: TripVibe[] = ["cultural", "foodie"];

// How long the destination's text stays as typed before it is offered as a request to read.
const REQUEST_SETTLE_MS = 600;

/**
 * The place a one-sentence plan names, as the destination search knows it
 * (its name and coordinates), or null to keep it as typed: several places,
 * a slow search, or a top hit that is a different place.
 */
async function findExpressPlace(name: string, locale: string): Promise<PlacePrediction | null> {
  if (name.includes("&")) return null;
  try {
    const response = await fetch("/api/destinations/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: name, limit: 1, locale }),
      signal: AbortSignal.timeout(2500),
    });
    const top = ((await response.json()) as { predictions?: PlacePrediction[] }).predictions?.[0];
    return top && matchesPlace(name, top) ? top : null;
  } catch {
    return null;
  }
}

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
  /** Month (1-12) the server rendered with: orders the popular picks on both sides of hydration. */
  seasonMonth: number;
  /** Server-resolved: signed in with trips already, so step 1 opens with the welcome-back banner. */
  returningUser?: boolean;
  /** The signed-in user returningUser was counted for; null when the server did not count. */
  returningUserCheckedFor?: string | null;
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
  seasonMonth,
  returningUser = false,
  returningUserCheckedFor = null,
}: NewTripWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Which result screen this browser sees: the sky or the classic one (lib/experiments/result-sky).
  const [skyTest] = useState<SkyAssignment>(() => {
    if (typeof window === "undefined") return { arm: "classic", counted: false };
    let store: Storage | null = null;
    try {
      store = window.localStorage;
    } catch {
      store = null;
    }
    return assignSky({
      asked: searchParams?.get("result_variant"),
      store,
      now: Date.now(),
      random: Math.random,
      pin: process.env.NEXT_PUBLIC_RESULT_SKY,
    });
  });
  useEffect(() => {
    onPostHogReady((posthog) => syncSkyArm(posthog, skyTest));
  }, [skyTest]);
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
  const t = useTranslations("trips");
  const AssistantPanelView = warmedAssistantPanel ?? AnonAssistantPanel;
  const ShareButtonView = warmedShareButton ?? AnonymousShareButton;
  const RegenerateButtonView = warmedRegenerateButton ?? RegenerateButton;
  // Locale is forwarded into the wizard_step_events rows so the funnel
  // can be sliced by language without joining back to URL paths. See
  // /api/wizard-event + the trackWizardEvent helper above.
  const locale = useLocale();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedItinerary, setGeneratedItinerary] = useGeneratedPlan();
  // Result-view UX state (parity with /trips/template/[id]): users can hide
  // the map (mobile screen real estate) and pick Cards or Timeline.
  const [showMap, setShowMap] = useState(true);
  const [resultViewMode, setResultViewMode] = useState<"cards" | "timeline">("cards");
  // A question put to the assistant from the plan itself (a packed day's button).
  const [assistantAsked, setAssistantAsked] = useState<{ id: number; message: string } | null>(null);
  // The timeline's travel legs: estimated from coordinates, no API call.
  const { travelData, isLoading: travelLoading } = useTravelDistances(generatedItinerary?.days);
  // The plan as it streams in, for GenerationProgress (hooks/useGenerationProgress.ts).
  const streamed = useGenerationProgress();

  // Who's coming. Captured as PostHog `trip_intent_selected`,
  // forwarded as group_size / trip_intent on later events and saved with the
  // trip, so collab demand is measurable. Group intent also shows an invite
  // hint in step 1; group and family put the anonymous share button in crew mode.
  // "unspecified" = user clicked Continue without touching the toggle.
  const [tripIntent, setTripIntent] = useState<TripIntent>(() => {
    const who = searchParams?.get("who");
    return isChosenTripIntent(who) ? who : "unspecified";
  });

  // Auth state comes from the single AuthProvider, not a local getUser()
  // listener. isAuthenticated is tri-state (null = loading, then true/false);
  // the JSX gating relies on null meaning "not known yet".
  const { user: authUser, loading: authLoading } = useAuth();
  const isAuthenticated: boolean | null = authLoading ? null : !!authUser;
  // The trip a signup claimed, for its banner (hooks/useClaimedTrip.ts); the
  // PostHog super-property effect below reads it.
  const { claimedTripId, setClaimedTripId, dismissClaimedTrip } = useClaimedTrip({ isFreshSignup, authLoading, authUser });

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
  const hasExistingTrips = useHasExistingTrips(authLoading, authUser?.id ?? null, {
    userId: returningUserCheckedFor,
    hasTrips: returningUser,
  });
  const [showReturningUserBanner, setShowReturningUserBanner] = useState(true);

  // First-run view, once per mount. Keyed on the latched param, not on auth
  // state, so it fires only for someone who just created an account.
  const firstRunViewedRef = useRef(false);
  useEffect(() => {
    if (!isFreshSignup || firstRunViewedRef.current) return;
    firstRunViewedRef.current = true;
    void captureWizardFirstRunViewed({ auth_event: authEventAtMount ?? "" });
  }, [isFreshSignup, authEventAtMount]);

  // Personalization preferences live in profile settings; the AI generation
  // API reads them from the database. The wizard sends only this trip's diet
  // (step 2), which replaces the profile's when one is picked.


  // Form state. A deep-linked destination is known before the first render,
  // so it is in the server HTML: applying it after hydration swapped the
  // popular picks for the date section in front of the visitor.
  const [destination, setDestination] = useState(
    () => prefilledDestination?.name ?? capitalizeFreeText(searchParams?.get("destination")),
  );
  const [destinationCoords, setDestinationCoords] = useState<{ latitude: number; longitude: number } | null>(
    () => (prefilledDestination ? { latitude: prefilledDestination.latitude, longitude: prefilledDestination.longitude } : null),
  );
  // The place name the coordinates belong to. A name typed after a pick keeps
  // the old coordinates in state, so the plan only gets them while it matches.
  const coordsPlaceRef = useRef<string | null>(prefilledDestination?.name ?? null);
  // Anchored trips: fixed commitments (flights, weddings, booked nights) the
  // generated plan must build around. Collapsed AnchorEditor on step 1; sent
  // to /api/ai/generate, and carried into trip_meta.anchors at save via
  // the answers, which must list them or saved trips lose them.
  const [anchors, setAnchors] = useState<TripAnchor[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // "I'm flexible" escape hatch for the required-dates gate (step 1). Tracks
  // whether the current dates were auto-filled as a flexible default so we can
  // surface an editable "flexible dates" note.
  const [flexibleDates, setFlexibleDates] = useState(false);
  // Where they're staying, when they said (components/wizard/StayField.tsx).
  const [stay, setStay] = useState<TripStay | null>(null);
  // A stay belongs to its destination: one far from the destination now chosen
  // isn't this trip's, so the field and the plan leave it out.
  const tripStay = stayFarFrom(stay, destinationCoords) ? null : stay;
  // Dates a one-tap pick pencilled in (see the one-tap starts below).
  const [datesPencilled, setDatesPencilled] = useState(false);
  // Multi-city: a route of city+nights rows, only surfaced in step 1 when
  // MULTI_CITY_ENABLED and mirrored into `destination`/`endDate` so the rest
  // of the wizard flow is untouched (hooks/useMultiCityRoute.ts).
  const { multiCityMode, setMultiCityMode, cityRows, setCityRows, resetRoute } = useMultiCityRoute({
    enabled: MULTI_CITY_ENABLED,
    deepLinked: searchParams?.get("multi") === "1",
    linkedCity: prefilledDestination?.name ?? null,
    startDate,
    setDestination,
    setEndDate,
  });
  // Popular-destination pills: real demand-ranked, reordered by season with the
  // month the server rendered with, so both sides of hydration agree and the
  // chips never move after mount. `plannedStat` is an honest, aggregate
  // (GDPR-safe) social-proof count from /api/wizard/planning-stats.
  const [popularPicks] = useState<SeasonalPopular[]>(() => seasonalPopular(seasonMonth));
  const inSeasonMonth = seasonMonth;
  const [plannedStat, setPlannedStat] = useState<number | null>(null);
  useEffect(() => {
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
  const [budgetTier, setBudgetTier] = useState<BudgetTier>("balanced");
  // Backpacker Mode. Default "classic"; "backpacker" (a) passes travelStyle to
  // the generate API so Gemini gets the backpacker directive, (b) persists
  // travel_style into trip_meta. It arrives with a link from the backpacker
  // page, a restored draft or a session-tray snapshot; the step-1 toggle only
  // shows while it is active.
  const [travelStyle, setTravelStyle] = useState<"classic" | "backpacker">(() =>
    searchParams?.get("style") === "backpacker" ? "backpacker" : "classic",
  );
  const [pace, setPace] = useState<TripPace>("moderate");
  const [selectedVibes, setSelectedVibes] = useState<TripVibe[]>([]);
  // The vibes are the season's suggestion until the traveller picks one.
  const [vibesSuggested, setVibesSuggested] = useState(false);
  const [requirements, setRequirements] = useState("");
  // Must-do wishlist: undated wishes ("Great Wall", "eat Peking duck")
  // entered as chips on step 2. Distinct from anchors (date-pinned) and from
  // the requirements prose. Capped as the server caps them (lib/trips/request-limits).
  const [mustDos, setMustDos] = useState<string[]>([]);
  const [mustDoInput, setMustDoInput] = useState("");
  // Diets the plan's places to eat must suit (step 2 chips).
  const [dietary, setDietary] = useState<Diet[]>([]);
  const [seasonalContext, setSeasonalContext] = useState<SeasonalContext | null>(null);

  // UX enhancement state
  const [showStartOverModal, setShowStartOverModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

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

  // Collapsible preferences state (budget/pace/requirements shown on demand in step 2)
  const [showAdvancedPrefs, setShowAdvancedPrefs] = useState(false);
  // The funnel: step views, first touches, the step-1 heartbeat and the
  // abandonment row (hooks/useWizardFunnel.ts).
  const { trackFieldInteraction, markCompleted: markWizardCompleted } = useWizardFunnel({
    step,
    entryResolved,
    locale,
    tripIntent,
    travelStyle,
    destination,
    startDate,
    endDate,
    vibes: selectedVibes,
  });
  // The generation under way, for its row when the page is left mid-wait.
  const generationInFlightRef = useRef<GenerationReport | null>(null);
  useGenerationLeft(generationInFlightRef);

  // A full regenerate replaces the assistant's edits, so it asks first instead
  // of silently discarding them.
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  // Changing the dates on the result, instead of starting over (hooks/useChangeDates.ts).
  const { showChangeDates, setShowChangeDates, planningExtraDays, datesNotice, forgetDatesChange, changeDates } = useChangeDates({
    plan: generatedItinerary,
    onPlan: setGeneratedItinerary,
    onDates: (start, end) => {
      setStartDate(start);
      setEndDate(end);
      // The traveller chose these dates, so they are not pencilled in.
      setFlexibleDates(false);
      setDatesPencilled(false);
    },
  });
  // A plan that replaces this one (every generation, restore and tray swap)
  // takes with it what was about this one: the dates note, the extra days still
  // being planned, and the assistant's chat, which starts again (planNumber).
  const [planNumber, setPlanNumber] = useState(0);
  const forgetPlan = useCallback(() => {
    forgetDatesChange();
    setPlanNumber((n) => n + 1);
  }, [forgetDatesChange]);

  // Pre-fill the SHAPE of the trip (length, budget, vibes) from a blog CTA, so
  // a reader arriving from "3-day Paris itinerary" doesn't have to retype the
  // trip the article described. The params are derived from what the post
  // itself declares (lib/blog/trip-prefill.ts) and validated in page.tsx, so by
  // the time they get here they are already known-good or absent.
  //
  // Runs once on mount. Draft recovery runs later and overwrites this on
  // purpose — a trip the reader actually started outranks a query string they
  // never typed.
  useEffect(() => {
    if (!prefilledTripShape) return;
    const { days, budget, vibes, mustDos: mustDosToKeep } = prefilledTripShape;
    if (!days && !budget && vibes.length === 0 && mustDosToKeep.length === 0) return;

    if (budget) setBudgetTier(budget);
    if (vibes.length > 0) setSelectedVibes(vibes as TripVibe[]);
    if (mustDosToKeep.length > 0) setMustDos(mustDosToKeep);

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
      const today = localTodayISO();
      const start = addIsoDaysOrThrow(today, 21);
      setStartDate(start);
      setEndDate(addIsoDaysOrThrow(start, days - 1));
      setFlexibleDates(true);
    }

    posthog?.capture("wizard_prefilled_from_article", {
      prefilled_days: days ?? null,
      prefilled_budget: budget ?? null,
      prefilled_vibes: vibes,
      has_destination: Boolean(prefilledDestination || searchParams?.get("destination")),
      multi_city: Boolean(isMultiDeeplink),
      // A public trip page's "plan one like this" carries its length too, and
      // Check my plan's "fix it" the places worth keeping.
      from: prefillSource(searchParams?.get("from")),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoized VibeSelector handler so the child's React.memo can short-circuit;
  // a new function identity on every parent render would bust memoization and
  // make step 2 expensive to re-render.
  const handleVibesChange = useCallback(
    (v: TripVibe[]) => {
      trackFieldInteraction("vibe");
      setSelectedVibes(v);
      setVibesSuggested(false);
    },
    [trackFieldInteraction]
  );

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

  // What a restored draft, an opened kept plan or a tray swap fills in.
  const draftTargets: DraftTargets = useMemo(
    () => ({
      setDestination,
      setStartDate,
      setEndDate,
      setPace,
      setSelectedVibes,
      setBudgetTier,
      setMustDos,
      setDietary,
      setTravelStyle,
      setAnchors,
      setTripIntent,
      setFlexibleDates,
      setStay,
      setGeneratedItinerary: (plan: GeneratedItinerary) => {
        forgetPlan();
        setGeneratedItinerary(plan);
      },
      registerRestore: registerSessionRestore,
    }),
    [setGeneratedItinerary, registerSessionRestore, forgetPlan]
  );

  // A stored draft brought back: put back, offered or discarded, and a
  // generation resumed after signing up (hooks/useDraftRestore.ts).
  const { showDraftRecovery, setShowDraftRecovery, draftAutoRestored, handleRestoreDraft, handleDiscardDraft } = useDraftRestore({
    draft,
    hasDraft,
    isExpired,
    clearDraft,
    draftTargets,
    isAuthenticated,
    authUser,
    generatedItinerary,
    generating,
    savedTripId,
    destination,
    startDate,
    endDate,
    selectedVibes,
    locale,
    // Read when the resumed generation starts, after this render.
    handleGenerate: () => handleGenerate(),
  });

  // Every answer on the form, which a draft keeps beside the itinerary so a
  // restore (after sign-in, a reload, a failed generation) puts them all back.
  // A field left out here is silently lost on that round trip. The saved
  // trip, the kept plan and the session tray are built from it too
  // (lib/wizard/answers.ts).
  const answers: WizardAnswers = useMemo(
    () => ({
      destination,
      startDate,
      endDate,
      pace,
      vibes: selectedVibes,
      budgetTier,
      travelStyle,
      anchors,
      mustDos,
      dietary,
      tripIntent,
      flexibleDates,
      stay: tripStay,
    }),
    [destination, startDate, endDate, pace, selectedVibes, budgetTier, travelStyle, anchors, mustDos, dietary, tripIntent, flexibleDates, tripStay]
  );

  // Keep a draft of the itinerary until the trip is saved, then none.
  //
  // Once the trip exists, the row is the copy that survives: the auto-save arm
  // UPDATEs it on every edit. A draft written after that has no link to the
  // row, so a later visit to the wizard would auto-restore it and the
  // auto-save arm would insert it as a second trip. So a saved trip clears the
  // draft instead.
  //
  // `answers` changes with any of them, so a "Who's coming?" changed after
  // generating reaches the draft too; a stale one would corrupt the very
  // measurement that field exists for.
  useEffect(() => {
    if (!generatedItinerary) return;
    if (savedTripId) {
      clearDraft();
      return;
    }
    saveDraft({ generatedItinerary, ...answers });
  }, [generatedItinerary, answers, saveDraft, savedTripId, clearDraft]);

  // Always on, unless NEXT_PUBLIC_AUTO_SAVE_FORCE=off (lib/trips/autoSaveGate.ts).
  const autoSaveEnabled = shouldAutoSave(process.env.NEXT_PUBLIC_AUTO_SAVE_FORCE);

  const [authPromptLocation, setAuthPromptLocation] = useState<AuthPromptLocation>("wizard_save");
  // Save (default) or the anonymous free-generation cap: same sign-up, the
  // modal words it for why we're asking.
  const [authPromptReason, setAuthPromptReason] = useState<"save" | "generation_limit">("save");
  // The save box closed with no sign-in: the result view offers the plan's link by email.
  const [saveBoxClosed, setSaveBoxClosed] = useState(false);
  // After signing up at the cap, come back to the wizard with the destination
  // filled in (the ?destination= deep link). Save keeps the modal's default.
  const limitRedirectPath =
    authPromptReason === "generation_limit" && destination
      ? `/trips/new?destination=${encodeURIComponent(destination)}`
      : undefined;
  // The same door the Save button opens for a signed-out planner, with the
  // draft parked first so the itinerary is on screen again after the auth
  // round-trip.
  const openKeepAuth = (location: AuthPromptLocation) => {
    if (generatedItinerary) {
      saveDraft({ generatedItinerary, ...answers });
    }
    setAuthPromptLocation(location);
    setAuthPromptReason("save");
    setShowAuthModal(true);
  };
  // -- Pending anonymous share ----------------------------------------------
  // A plan this browser shared while signed out, and the claim that makes it
  // this account's trip on sign-in (hooks/usePendingClaim.ts). Auto-save waits
  // while that claim is unresolved for the trip on screen.
  const {
    pendingClaim,
    deferAutoSave,
    adoptedTripId,
    sessionShareUrl,
    handleAnonShared,
    showPendingClaimBanner,
    handlePendingClaimAction,
  } = usePendingClaim({
    destination,
    startDate,
    endDate,
    isAuthenticated,
    generatedItinerary,
    step,
    claimedTripId,
    setClaimedTripId,
    setSavedTripId,
    openKeepAuth,
  });
  // -- The same trip, already saved ------------------------------------------
  // Asked before auto-save when this account already saved the place and
  // dates (hooks/useSameTripCheck.ts).
  const sameTrip = useSameTripCheck(
    autoSaveEnabled && isAuthenticated === true && !savedTripId && !adoptedTripId && !deferAutoSave &&
      (generating || generatedItinerary)
      ? { destination, startDate, endDate }
      : null,
    generatedItinerary
  );
  const awaitingTwinChoice = sameTrip.awaiting;
  const chooseTwin = (replaceId: string | null) => {
    void capture("wizard_twin_choice", { choice: replaceId ? "replace" : "keep_both", destination });
    sameTrip.choose(replaceId);
  };

  // Saving the plan, by either arm, and the Save button (hooks/useWizardSave.ts).
  const { autoSave, isUnsaved, autoSaving, claimingSharedPlan, handleSaveTrip, handleKeepSharedTrip } = useWizardSave({
    autoSaveEnabled,
    generatedItinerary,
    answers,
    derivedInterests: deriveInterestsFromVibes(),
    savedTripId,
    setSavedTripId,
    deferAutoSave,
    adoptedTripId,
    planHeldBy: sameTrip.holdingTripId,
    awaitingTwinChoice,
    replaceTripId: sameTrip.replaceTripId,
    draftAutoRestored,
    clearDraft,
    openKeepAuth,
    setLoading,
    setError,
  });

  // ── Unsaved-state derivation + nudge/exit instrumentation ────────────────
  const hasResult = Boolean(generatedItinerary);
  // The tray's restore-swap must never run while the auto-save arm is live:
  // useAutoSaveTrip's effect would UPDATE the persisted row with a DIFFERENT
  // trip's content on swap (verified in hooks/useAutoSaveTrip.ts persist()).
  // isAuthenticated === true matters — null is still-loading, and the
  // auto-save effect no-ops until auth resolves truthy anyway.
  const autoSaveArmActive = autoSaveEnabled && isAuthenticated === true;
  const sessionTrayVisible =
    hasResult && isUnsaved && !autoSaveArmActive && sessionTrips.length >= 2;

  // ── Kept plans ───────────────────────────────────────────────────────────
  // Every plan a signed-out planner makes is kept behind a private link for 30
  // days (hooks/useKeptPlan.ts): closing the tab or changing device loses
  // nothing, and the plan comes back from its link or from step 1's list.
  const keptPlanInput = useMemo<KeptPlan | null>(
    () =>
      generatedItinerary && answers.destination && answers.startDate && answers.endDate
        ? keptPlanOf(answers, generatedItinerary)
        : null,
    [generatedItinerary, answers]
  );
  const { kept: keptPlan, adoptOpened: adoptOpenedPlan } = useKeptPlan({
    enabled: isAuthenticated === false && hasResult && isUnsaved && !generating,
    planId: sessionTripCurrentId,
    plan: keptPlanInput,
  });
  // Free photos found for the plan's places after it was shown.
  usePlanPhotos({ plan: generatedItinerary, destination, onPlan: setGeneratedItinerary });
  // A kept plan opened from step 1's list or its link (hooks/useKeptPlanOpening.ts).
  const { keptPlans, openingKeptPlan, keptPlanGone, handleOpenKeptPlan } = useKeptPlanOpening({
    isAuthenticated,
    authUser,
    router,
    adoptOpenedPlan,
    setShowDraftRecovery,
    draftTargets,
    setDestinationCoords,
    setMultiCityMode,
    pace,
    selectedVibes,
    budgetTier,
    tripIntent,
  });

  // A plan on screen and not saved: the save nudges, the leave guard and the
  // exit event (hooks/useUnsavedPlan.ts).
  const { noteEditApplied } = useUnsavedPlan({ hasResult, isUnsaved, sessionTrayVisible, showAuthModal, getGenCount });
  // The assistant's edits to the plan on screen, and their undo (hooks/useAssistantEdits.ts).
  const { applyEdits, undoEdits, hasEdits, forgetEdits } = useAssistantEdits({
    plan: generatedItinerary,
    onPlan: setGeneratedItinerary,
    startDate,
    endDate,
    onEndDate: setEndDate,
    noteEditApplied,
  });

  // Regenerate, asking first when the assistant has changed this itinerary.
  const requestRegenerate = () => {
    if (hasEdits()) {
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
            was_auto_saved: wasAutoSaved && !autoSave.keepsSavedTrip,
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
    // Planning the same trip again asks again, instead of reusing this choice.
    sameTrip.forget();
    clearDraft();
    // Nothing is displayed after Start Over — drop the
    // session stack's current pointer. The stacked snapshots themselves
    // survive (that's the tray's whole point across generations).
    clearSessionTripCurrent();
    setGeneratedItinerary(null);
    setShowStartOverModal(false);
    setStep(1);
    // Reset the form: every answer back to a fresh wizard's (who's coming,
    // the travel style and the flexible-dates flag included, so the next trip
    // doesn't inherit them), and the rest of steps 1 and 2.
    applyAnswers(FRESH_ANSWERS, draftTargets);
    setDatesPencilled(false);
    setDestinationCoords(null);
    setRequirements("");
    setMustDoInput("");
    setSeasonalContext(null);
    // Reset the multi-city route too, or the sync effect rebuilds
    // destination/endDate from the stale route on its next run.
    resetRoute();
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
      ? routeLegs(cityRows).length
      : 0;
  const effectiveMaxTripDays =
    multiCityLegCount > 1 ? MAX_TRIP_DAYS_MULTI : MAX_TRIP_DAYS;
  // What still keeps step 1 from going on (lib/wizard/step1-gate.ts).
  const step1Block = step1Blocker(destination, startDate, endDate, effectiveMaxTripDays, localTodayISO());
  // A request the server refused as invalid fails the same way on every retry:
  // the error box says what to change and takes the traveller back to it.
  const errorFix = error && classifyGenerationFailure(error) === "validation" ? validationFix(error) : null;

  const canProceed = () => {
    switch (step) {
      case 1: {
        // Step 1: Destination + Dates combined. Mirrors validateTripParams
        // (lib/trips/request-validation.ts) so nothing that passes this gate
        // can bounce off the server's destination/date checks at generate time.
        return step1Block === null;
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
    const today = localTodayISO();
    const start = addIsoDaysOrThrow(today, 21);
    const end = addIsoDaysOrThrow(start, 4);
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
  const dateTriggerRef = useRef<HTMLButtonElement | null>(null);
  const handleOneTapStart = (place: OneTapPlace, index: number) => {
    trackFieldInteraction("destination_pill");
    setDestination(place.name);
    setDestinationCoords(place.coords);
    coordsPlaceRef.current = place.name;
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

  // A trip typed as one sentence ("5 days in Lisbon in March, food and
  // history") is planned straight from step 1, with the dates pencilled in and
  // the vibes it names, instead of reaching the planner as a place name.
  const expressTrip = useMemo(() => {
    if (step !== 1 || (MULTI_CITY_ENABLED && multiCityMode)) return null;
    const read = readTripSentence(destination);
    return isTripSentence(read) ? read : null;
  }, [step, multiCityMode, destination]);
  // A plan asked for by setting the fields first (the express plan, a place
  // the assistant offered): generated once they have landed in state.
  const generateWhenSetRef = useRef(false);
  const [expressBusy, setExpressBusy] = useState(false);

  const handleExpressPlan = async () => {
    if (!expressTrip || expressBusy) return;
    setExpressBusy(true);
    const trip = expressTrip;
    const place = await findExpressPlace(trip.destination, locale);
    // Dates the traveller picked stay; otherwise they are pencilled in.
    const chosen = startDate && endDate && !flexibleDates;
    const dates = chosen ? { start: startDate, end: endDate } : pencilledDates(trip, localTodayISO());
    // The same text a picked suggestion puts in the field.
    const placeName = place ? (place.fullText.length <= DESTINATION_MAX_LENGTH ? place.fullText : place.mainText) : trip.destination;
    setDestination(placeName);
    if (place?.coordinates) {
      setDestinationCoords(place.coordinates);
      coordsPlaceRef.current = placeName;
    }
    setStartDate(dates.start);
    setEndDate(dates.end);
    setFlexibleDates(!chosen);
    setSelectedVibes(trip.vibes.length > 0 ? trip.vibes : EXPRESS_VIBES);
    if (trip.intent) setTripIntent(trip.intent);
    if (trip.budget) setBudgetTier(trip.budget === "luxury" ? "premium" : "budget");
    trackFieldInteraction("express_plan");
    generateWhenSetRef.current = true;
    setExpressBusy(false);
  };

  // A whole trip typed as a request ("18 days in Vietnam in August, family of
  // four") rather than a place, read into step 1 on request: the place or the
  // route, the dates and who's going. The words go to the next step's notes
  // either way, so a request that can't be read loses nothing. Offered once
  // the typing pauses: "4 days in R", on the way to "4 days in Rome", is no
  // request, and the one-sentence card takes over a key later.
  const settledDestination = useDebounce(destination, REQUEST_SETTLE_MS);
  const requestLike =
    step === 1 &&
    !expressTrip &&
    !(MULTI_CITY_ENABLED && multiCityMode) &&
    destination === settledDestination &&
    looksLikeRequest(destination);
  const [readingRequest, setReadingRequest] = useState(false);
  // What a reading filled in, shown while the field still holds it.
  const [requestFilled, setRequestFilled] = useState<{ destination: string; capped: number | null } | null>(null);

  const handleReadRequest = async (): Promise<"filled" | "kept"> => {
    const text = destination.trim();
    setReadingRequest(true);
    trackFieldInteraction("read_request");
    const today = localTodayISO();
    const reading = await fetchReading(text, locale, today);
    const chosen = startDate && endDate && !flexibleDates ? { start: startDate, end: endDate } : null;
    const fill = reading ? fillOf(reading, { today, multiCity: MULTI_CITY_ENABLED, chosen }) : null;
    setRequirements((prev) => withNote(prev, text));
    // The time, who's going, vibes and budget, for the place filled in or picked next.
    const keepDetails = (f: NonNullable<typeof fill>) => {
      if (f.startDate) {
        setStartDate(f.startDate);
        setEndDate(f.endDate);
        setFlexibleDates(!f.datesSaid);
      }
      if (f.vibes.length > 0) setSelectedVibes(f.vibes);
      if (f.intent) setTripIntent(f.intent);
      if (f.budget) setBudgetTier(f.budget === "luxury" ? "premium" : "budget");
    };
    if (!fill?.destination) {
      setDestination("");
      if (fill) keepDetails(fill);
      setReadingRequest(false);
      return "kept";
    }
    let filledAs = fill.destination;
    if (fill.route) {
      // The route's mirror sets the destination and the end date from the rows.
      setMultiCityMode(true);
      setCityRows(fill.route);
    } else {
      const place = await findExpressPlace(fill.destination, locale);
      filledAs = place ? (place.fullText.length <= DESTINATION_MAX_LENGTH ? place.fullText : place.mainText) : fill.destination;
      setDestination(filledAs);
      setDestinationCoords(place?.coordinates ?? null);
      if (place?.coordinates) coordsPlaceRef.current = filledAs;
    }
    keepDetails(fill);
    setRequestFilled({ destination: filledAs, capped: fill.capped });
    setReadingRequest(false);
    return "filled";
  };

  // The assistant offered another place for the whole trip and the traveller
  // picked it: planned anew for the same dates and style. Must-dos belong to
  // the old place. The plan on screen stays in the session tray.
  const handlePlanElsewhere = (place: string) => {
    setDestination(place);
    setDestinationCoords(null);
    setMustDos([]);
    generateWhenSetRef.current = true;
  };

  // Generates once the fields set above have landed in state (the place name
  // always replaces what was there, so this runs after every such request).
  useEffect(() => {
    if (!generateWhenSetRef.current || generating) return;
    if (!destination || !startDate || !endDate || selectedVibes.length === 0) return;
    generateWhenSetRef.current = false;
    void handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, startDate, endDate, selectedVibes, generating]);

  // Footer state B: a valid destination with no dates. The slot offers an
  // ENABLED "Use flexible dates" instead of a disabled Continue with a hint,
  // on the step where most abandons happen. Label deliberately does not
  // match /continue|next/i so the e2e specs keep selecting the real one.
  const footerStateB =
    step === 1 &&
    destinationProblem(destination) === null &&
    !(startDate && endDate) &&
    !(MULTI_CITY_ENABLED && multiCityMode);

  // Handle destination selection from autocomplete
  const handleDestinationSelect = (prediction: PlacePrediction) => {
    if (prediction.coordinates) {
      setDestinationCoords(prediction.coordinates);
      // The text a picked suggestion puts in the field (DestinationAutocomplete).
      coordsPlaceRef.current = prediction.fullText;
    }
    // Track destination selection
    trackDestinationSelected({
      destination: prediction.fullText,
      source: "autocomplete",
    });
  };

  const handleGenerate = async (opts: { fresh?: boolean } = {}) => {
    // A new itinerary replaces the one the edits and the rest were about.
    forgetEdits();
    forgetPlan();
    // Step 1's rules, checked again: what passed step 1 may no longer hold.
    // handleSessionTrayRestore forces multiCityMode off (see its comment) and
    // a route can drop to one filled row, leaving a 21-day span for a
    // single-city request; the start date can pass while the page is open.
    // Returning HERE, before bumpGenCount and the `generating` row, means a
    // doomed attempt costs no round-trip and leaves no phantom "generating"
    // that reads as a dead end in the funnel.
    const block = step1Blocker(destination, startDate, endDate, effectiveMaxTripDays, localTodayISO());
    if (block) {
      setError(t(STEP1_HINT[block], { days: effectiveMaxTripDays }));
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
        ...answers,
      });
    }

    setGenerating(true);
    setError(null);

    // Start fetching the result-view chunks here, not when the result mounts.
    // handleGenerate is the single choke point for every generation path, so
    // this one call covers the Generate button, the error Retry, regenerate
    // and post-auth resume alike. See preloadResultViewChunks for why.
    preloadResultViewChunks();

    // What this generation reports, wherever it is counted (lib/wizard/generation-reports.ts).
    const report: GenerationReport = {
      destination,
      startDate,
      endDate,
      budgetTier,
      tripIntent,
      travelStyle,
      locale,
      startedAt: Date.now(),
      // A trip across cities always gets the classic screen, so it isn't in the test.
      resultVariant: skyTest.counted && !(MULTI_CITY_ENABLED && multiCityMode) ? skyTest.arm : undefined,
    };
    captureTripWizardStepCompleted({
      step_number: 2,
      step_name: "vibes_preferences",
    });
    // Mark the wizard as completed so the abandonment listener doesn't
    // fire on the inevitable post-generation page transition.
    markWizardCompleted();
    reportGenerationStarted(report);
    generationInFlightRef.current = report;

    try {
      // Multi-city sends the route legs so /api/ai/generate fans out per city;
      // `destination` already carries the combined label (synced effect above).
      // Interests are derived from the vibes (lib/wizard/generation-request.ts).
      const request = generationRequest(answers, {
        legs: MULTI_CITY_ENABLED && multiCityMode ? routeLegs(cityRows) : [],
        interests: deriveInterestsFromVibes(),
        seasonalContext,
        requirements,
        locale,
        fresh: opts.fresh,
        coordinates: destinationCoords && coordsPlaceRef.current === destination ? destinationCoords : null,
      });
      reportGenerationAsks({ anchored: request.isAnchored, anchors, mustDos, startDate, endDate });
      // Each try streams its days into GenerationProgress as they arrive.
      const { result: data } = await generateWithRecovery((generationId) =>
        attemptGeneration(
          generationId,
          { body: request.body, stream: request.stream, signedIn: Boolean(authUser) },
          streamed.progress
        )
      );
      if (data.capped) {
        // Ask for a free account, with the destination kept for the way back,
        // instead of throwing the server's English error. Its own step, so the
        // funnel does not count it as a generation that failed.
        void trackWizardEvent("generation_capped", { destination, locale });
        setAuthPromptLocation("wizard_generation_limit");
        setAuthPromptReason("generation_limit");
        setShowAuthModal(true);
        setGenerating(false);
        return;
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
        recordSessionGeneration(sessionTripOf(answers, data.itinerary));
      }

      reportGenerated(report, Boolean(data.itinerary));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      reportGenerationFailed(report, err);
    } finally {
      generationInFlightRef.current = null;
      setGenerating(false);
    }
  };

  // Flip the result view to an earlier generation from the session tray.
  // Refreshes the currently displayed trip into the stack first (so applied
  // assistant edits survive the swap), then puts the clicked plan back with
  // its own answers (lib/wizard/apply-draft.ts applySessionTrip). Coordinates
  // are cleared and multi-city mode is turned off, otherwise the multi-city
  // sync effect rebuilds destination/endDate from stale rows on its next run.
  // Only reachable while sessionTrayVisible (unsaved + auto-save arm not
  // active), so a swap can never UPDATE/INSERT a persisted trip row.
  const handleSessionTrayRestore = (id: string) => {
    if (!generatedItinerary || id === sessionTripCurrentId) return;
    const snap = swapSessionTrip(id, sessionTripOf(answers, generatedItinerary));
    if (!snap) return;
    void capture("save_nudge_action", {
      source: "session_tray",
      action: "restore",
      gen_count: getGenCount(),
    });
    applySessionTrip(snap, { ...draftTargets, setDestinationCoords, setMultiCityMode });
    setError(null);
  };

  // Show generated itinerary
  if (generatedItinerary) {
    const fullDestination = `${generatedItinerary.destination.name}, ${generatedItinerary.destination.country}`;
    const tripTitle = newTripTitle(generatedItinerary.destination.name, locale);
    // Multi-city: route stops (city + consecutive nights + transit labels
    // from the merged transfer legs) for the Journey ribbon. Empty on
    // single-city trips.
    const mcStops = buildJourneyStops(generatedItinerary.days, locale);

    // Calculate total activities for modal
    const totalActivities = generatedItinerary.days.reduce((acc, day) => acc + day.activities.length, 0);
    // The sky draws one place's days; a trip across cities keeps the classic plan.
    const sky = skyTest.arm === "sky" && mcStops.length <= 1;
    const askAssistant = (message: string) => {
      void captureRefineSuggestionClicked({ source: "packedDay", derived: true });
      setAssistantAsked((last) => ({ id: (last?.id ?? 0) + 1, message }));
    };
    const tripsTray = sessionTrayVisible && (
      <SessionTripsTray trips={sessionTrips} currentId={sessionTripCurrentId} onRestore={handleSessionTrayRestore} />
    );
    // Save/generation error, shown here as well as in the form view: without
    // it an authed Save failure on the result looks like a dead button.
    const errorAlert = error && (
      <div role="alert" className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );

    // The no-account share the header bar, the phone bar and the assistant offer.
    const anonShare = {
      ...anonymousShare({
        itinerary: generatedItinerary,
        tripTitle,
        destination,
        startDate,
        endDate,
        locale,
        tripIntent,
        sessionShareUrl,
      }),
      onShared: handleAnonShared,
      onKeep: handleKeepSharedTrip,
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white pb-24 sm:pb-8">
        <ChangeDatesModal
          isOpen={showChangeDates}
          onClose={() => setShowChangeDates(false)}
          startDate={startDate}
          endDate={endDate}
          currentDays={generatedItinerary.days.length}
          maxDays={effectiveMaxTripDays}
          minDate={localTodayISO()}
          maxStartDate={MAX_TRIP_START_DATE}
          onConfirm={(start, end) => void changeDates(start, end, { maxDays: effectiveMaxTripDays, applyEdits })}
        />

        {/* A full regenerate replaces the assistant's edits: ask first. */}
        <RegenerateConfirmModal
          isOpen={confirmRegenerate}
          onClose={() => setConfirmRegenerate(false)}
          onRegenerate={() => {
            setConfirmRegenerate(false);
            void handleRegenerate();
          }}
        />

        {/* Start Over Modal */}
        <StartOverModal
          isOpen={showStartOverModal}
          onClose={() => setShowStartOverModal(false)}
          onConfirm={handleStartOver}
          destination={fullDestination}
          tripDays={generatedItinerary.days.length}
          activitiesCount={totalActivities}
          wasAutoSaved={autoSaveEnabled && Boolean(autoSave.savedTripId) && !autoSave.keepsSavedTrip}
          keepsSavedTrip={autoSave.keepsSavedTrip}
          keptPlan={Boolean(keptPlan)}
          onChangeDatesInstead={
            mcStops.length > 1
              ? undefined
              : () => {
                  posthog?.capture("wizard_start_over_changed_dates_instead");
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
          onClose={() => {
            setShowAuthModal(false);
            if (authPromptReason === "save") setSaveBoxClosed(true);
          }}
          destination={destination}
          location={authPromptLocation}
          reason={authPromptReason}
          redirectPath={limitRedirectPath}
        />

        {/* Hero with Cover Image */}
        {!sky && (
        <DestinationHero
          destination={fullDestination}
          title={fullDestination}
          subtitle={generatedItinerary.destination.description}
          dateRange={formatDateRange(startDate, endDate, locale)}
          onEditDates={planningExtraDays || mcStops.length > 1 ? undefined : () => setShowChangeDates(true)}
          editDatesLabel={t("wizard.changeDates.button")}
          budget={{
            total: generatedItinerary.trip_summary.total_estimated_cost,
            currency: generatedItinerary.trip_summary.currency,
          }}
          days={generatedItinerary.days.length}
          tags={generatedItinerary.destination.best_for}
          showBackButton={false}
          freePhotosOnly
        />
        )}

        {/* This place and these dates are already saved: replace or keep both. */}
        {awaitingTwinChoice && sameTrip.twin && <SameTripPrompt twin={sameTrip.twin} onChoose={chooseTwin} />}

        {/* Dates: pencilled in for the traveller, being extended, or a longer
            trip whose extra days could not be planned. Multi-city dates come
            from per-city nights, so the change control stays out of it. */}
        {mcStops.length <= 1 && (flexibleDates || planningExtraDays || datesNotice) && (
          <ResultDatesNotice
            planningExtraDays={planningExtraDays}
            datesNotice={datesNotice}
            dateRange={formatDateRange(startDate, endDate, locale)}
            onSetDates={() => setShowChangeDates(true)}
          />
        )}

        {/* Multi-city: the Journey ribbon hero (only when the trip spans >1 city) */}
        {mcStops.length > 1 && (
          <div className="max-w-6xl mx-auto px-4 pt-4">
            <JourneyRibbon stops={mcStops} />
          </div>
        )}

        <ResultActionBars
          generatedItinerary={generatedItinerary}
          totalCost={
            convertCurrency(
              generatedItinerary.trip_summary.total_estimated_cost,
              generatedItinerary.trip_summary.currency
            ).formatted
          }
          tripTitle={tripTitle}
          startDate={startDate}
          endDate={endDate}
          isAuthenticated={isAuthenticated}
          savedTripId={savedTripId}
          autoSave={autoSaveEnabled ? autoSave : null}
          autoSaving={autoSaving}
          isUnsaved={isUnsaved}
          keptPlan={keptPlan}
          offerPlanEmail={saveBoxClosed}
          saving={loading || claimingSharedPlan}
          onSave={handleSaveTrip}
          onStartOver={() => setShowStartOverModal(true)}
          requestRegenerate={requestRegenerate}
          regenerating={isRegenerating || generating}
          share={anonShare}
          ShareButton={ShareButtonView}
          RegenerateButton={RegenerateButtonView}
        />

        {sky && (
          <>
            {(tripsTray || errorAlert) && (
              <div className="max-w-6xl mx-auto px-4 pt-6">
                {tripsTray}
                {errorAlert}
              </div>
            )}
            <SkyPlan
              itinerary={generatedItinerary}
              dateRange={formatDateRange(startDate, endDate, locale)}
              totalCost={
                convertCurrency(generatedItinerary.trip_summary.total_estimated_cost, generatedItinerary.trip_summary.currency).formatted
              }
              onEditDates={planningExtraDays ? undefined : () => setShowChangeDates(true)}
              editDatesLabel={t("wizard.changeDates.button")}
              pace={pace}
              onAskAssistant={askAssistant}
              onShowMap={() => {
                setShowMap(true);
                requestAnimationFrame(() => document.getElementById(MAP_SECTION_ID)?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}
            />
          </>
        )}

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Session trips tray. Sits at the top of the scrollable result
              content (directly under the sticky header) so it never disturbs
              the hero or sticky layers. Visibility gated on
              sessionTrayVisible: ≥2 stacked trips, current trip unsaved,
              auto-save arm not active. */}
          {!sky && tripsTray}
          {!sky && errorAlert}
          {/* AI assistant — Q&A + day-scoped edits at peak intent. */}
          <div className="mb-8">
            <AssistantPanelView
              key={planNumber}
              destination={fullDestination}
              tripTitle={tripTitle}
              days={generatedItinerary.days}
              language={generatedItinerary.language}
              startDate={startDate}
              endDate={endDate}
              onApplyEdits={applyEdits}
              onUndoEdits={undoEdits}
              onPlanElsewhere={handlePlanElsewhere}
              asked={assistantAsked}
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
                  <ShareButtonView {...anonShare} />
                ) : undefined
              }
            />
          </div>

          {sky ? (
            <ResultOverview
              generatedItinerary={generatedItinerary}
              fullDestination={fullDestination}
              pace={pace}
              showMap={showMap}
              setShowMap={setShowMap}
            />
          ) : (
            <ResultItinerary
              generatedItinerary={generatedItinerary}
              fullDestination={fullDestination}
              pace={pace}
              resultViewMode={resultViewMode}
              setResultViewMode={setResultViewMode}
              showMap={showMap}
              setShowMap={setShowMap}
              travelData={travelData}
              travelLoading={travelLoading}
              handleSaveTrip={handleSaveTrip}
              loading={loading}
              onAskAssistant={askAssistant}
            />
          )}

          <AiDisclaimer title={t("wizard.result.aiVerifiedTitle")} className="mt-10">
            {t("wizard.result.aiVerifiedBody")}
          </AiDisclaimer>

          {/* Simple Regenerate CTA for users who scrolled to the bottom */}
          <div className="mt-8 flex flex-col items-center gap-4 pb-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t("wizard.result.notQuiteRight")}
            </div>
            <RegenerateButtonView
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
        streamedDays={streamed.days}
        streamedOutline={streamed.outline}
        streamedTotalDays={streamed.totalDays}
      />
    );
  }

  // Continue: the step's completion event, then step 2 seeded with the
  // season's vibes when the planner has picked none.
  const handleContinue = () => {
    captureTripWizardStepCompleted({
      step_number: step,
      step_name: WIZARD_STEP_NAMES[step - 1],
      ...(step === 1
        ? { dates_mode: flexibleDates ? "flexible" : "exact", one_tap: datesPencilled }
        : {}),
    });
    // Pre-apply seasonal vibe suggestions when advancing into
    // step 2, so the user doesn't have to re-pick by hand what
    // step 1 suggested. Only seeds if the user hasn't already
    // picked vibes (don't clobber their choices).
    if (step === 1 && seasonalContext && selectedVibes.length === 0 && startDate) {
      try {
        const seed = seasonalVibeSeed(seasonalContext, startDate);
        if (seed.length > 0) {
          setSelectedVibes(seed);
          setVibesSuggested(true);
        }
      } catch (err) {
        // Non-fatal: if the helper throws, step 2 just
        // starts empty.
        console.warn("[wizard] seasonal vibe seed failed:", err);
      }
    }
    setStep(step + 1);
  };

  // Wizard form
  return (
    <div className="min-h-screen bg-[var(--background)]">
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
      <WizardHeader isAuthenticated={isAuthenticated} step={step} totalSteps={TOTAL_STEPS} />

      {/* Form Content — extra bottom padding on mobile for sticky nav */}
      <main className="max-w-2xl mx-auto px-4 py-6 sm:py-8 pb-28 sm:pb-8">
        {/* Returning User Banner - shows on step 1 for authenticated users with trips */}
        {/* Suppressed for a fresh signup and while a claimed trip is shown: a
            claim flips hasExistingTrips to true one tick later and "Welcome
            back — you already have trips" would contradict "your trip came
            with you" for someone who created the account a minute ago. */}
        {isAuthenticated !== false && hasExistingTrips && showReturningUserBanner && step === 1 && !claimedTripId && !isFreshSignup && (
          <ReturningUserBanner onDismiss={() => setShowReturningUserBanner(false)} />
        )}

        {error && (
          <GenerationErrorNotice
            error={error}
            errorFix={errorFix}
            effectiveMaxTripDays={effectiveMaxTripDays}
            onAction={() => {
              setError(null);
              if (errorFix) setStep(validationFixStep(errorFix));
              else handleGenerate();
            }}
          />
        )}

        {/* Step 1: Destination + Dates (combined for fewer drop-offs).
            Layout uses flex+order so the PRIMARY inputs (Destination + Dates)
            lead, and the optional sections (Backpacker / Who's-coming, each
            marked order-last) fall below them. This is the highest-abandon
            screen: required inputs buried under optional cards would also sit
            under the first-visit cookie banner. */}
        {step === 1 && (
          <div className="flex flex-col gap-6">
            <Step1Notices
              claimedTripId={claimedTripId}
              dismissClaimedTrip={dismissClaimedTrip}
              showPendingClaimBanner={showPendingClaimBanner}
              pendingClaim={pendingClaim}
              handlePendingClaimAction={handlePendingClaimAction}
              isExpired={isExpired}
              draft={draft}
              generatedItinerary={generatedItinerary}
              keptPlanGone={keptPlanGone}
              isAuthenticated={isAuthenticated}
              keptPlans={keptPlans}
              locale={locale}
              openingKeptPlan={openingKeptPlan}
              handleOpenKeptPlan={handleOpenKeptPlan}
              showDraftRecovery={showDraftRecovery}
              handleRestoreDraft={handleRestoreDraft}
              handleDiscardDraft={handleDiscardDraft}
            />
            <WizardMasthead
              variant={mastheadVariant}
              destination={prefilledDestination?.name ?? searchParams?.get("destination") ?? null}
              plannedStat={plannedStat}
              locale={locale}
            />

            <TripOptions
              travelStyle={travelStyle}
              setTravelStyle={setTravelStyle}
              tripIntent={tripIntent}
              setTripIntent={setTripIntent}
            />

            {MULTI_CITY_ENABLED && (
              <MultiCityRoute
                multiCityMode={multiCityMode}
                setMultiCityMode={setMultiCityMode}
                startDate={startDate}
                endDate={endDate}
                cityRows={cityRows}
                setCityRows={setCityRows}
              />
            )}

            {/* Destination (single-city; hidden in multi-city mode) */}
            <DestinationField
              multiCityMode={multiCityMode}
              destination={destination}
              setDestination={setDestination}
              trackFieldInteraction={trackFieldInteraction}
              handleDestinationSelect={handleDestinationSelect}
              expressTrip={expressTrip}
              locale={locale}
              popularPicks={popularPicks}
              inSeasonMonth={inSeasonMonth}
              handleOneTapStart={handleOneTapStart}
              onKeepAsNote={() => {
                setRequirements((prev) => withNote(prev, destination));
                setDestination("");
              }}
              requestLike={requestLike}
              readingRequest={readingRequest}
              onReadRequest={handleReadRequest}
            />

            {/* What a request filled in (a route hides the field above, so it sits here). */}
            {requestFilled && destination === requestFilled.destination && (
              <p className="text-sm text-[var(--foreground)]" aria-live="polite">
                {t("wizard.step1.request.filled")}
                {requestFilled.capped !== null && ` ${t("wizard.step1.request.capped", { max: requestFilled.capped })}`}
              </p>
            )}

            {/* Multi-city toggle — gated by NEXT_PUBLIC_MULTI_CITY_ENABLED.
                Sits directly after the destination block in both states, so
                an advanced option never leads the form: when on, the route
                builder above replaces the destination field, so the switch
                stays adjacent to what it controls. The ?multi=1 deep link and
                the sync effect key off state, not DOM position. */}
            {MULTI_CITY_ENABLED && (
              <MultiCityToggle multiCityMode={multiCityMode} setMultiCityMode={setMultiCityMode} />
            )}

            {/* Dates — shown immediately below destination */}
            <TripDatesField
              multiCity={MULTI_CITY_ENABLED && multiCityMode}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              maxStartDate={MAX_TRIP_START_DATE}
              cityRows={cityRows}
              dateTriggerRef={dateTriggerRef}
              trackFieldInteraction={trackFieldInteraction}
              flexibleDates={flexibleDates}
              setFlexibleDates={setFlexibleDates}
              datesPencilled={datesPencilled}
              setDatesPencilled={setDatesPencilled}
              effectiveMaxTripDays={effectiveMaxTripDays}
              handleFlexibleDates={handleFlexibleDates}
            />

            {/* Where they're staying: one small link until opened. A stay is in
                one city, so a trip through several has none. */}
            {!(MULTI_CITY_ENABLED && multiCityMode) && (
              <StayField stay={tripStay} onChange={setStay} near={destinationCoords} />
            )}

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
                onImportUndated={(items) => setRequirements((prev) => withUndatedItems(prev, items))}
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
          <PreferencesStep
            destination={destination}
            selectedVibes={selectedVibes}
            handleVibesChange={handleVibesChange}
            vibesSuggested={vibesSuggested}
            mustDos={mustDos}
            setMustDos={setMustDos}
            mustDoInput={mustDoInput}
            setMustDoInput={setMustDoInput}
            dietary={dietary}
            setDietary={setDietary}
            showAdvancedPrefs={showAdvancedPrefs}
            setShowAdvancedPrefs={setShowAdvancedPrefs}
            budgetTier={budgetTier}
            setBudgetTier={setBudgetTier}
            pace={pace}
            setPace={setPace}
            requirements={requirements}
            setRequirements={setRequirements}
          />
        )}

        <WizardFooter
          footerRef={footerRef}
          step={step}
          setStep={setStep}
          totalSteps={TOTAL_STEPS}
          expressTrip={Boolean(expressTrip)}
          canProceed={canProceed}
          footerStateB={footerStateB}
          step1Block={step1Block}
          effectiveMaxTripDays={effectiveMaxTripDays}
          isAuthenticated={isAuthenticated}
          handleExpressPlan={handleExpressPlan}
          expressBusy={expressBusy}
          handleFlexibleDates={handleFlexibleDates}
          setDatesPencilled={setDatesPencilled}
          handleContinue={handleContinue}
          handleGenerate={handleGenerate}
          readOffered={requestLike}
        />
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
