"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import dynamic from "next/dynamic";

// Bundle-size note (task #152/#167): we used to import
// `getDestinationBySlug` from `@/lib/destinations/data`, which dragged the
// full ~477 KB curated destinations dataset into the /trips/new client
// chunk just to resolve the optional `?destination=<slug>` deeplink on
// mount. The page now sits behind a server component (./page.tsx) that
// resolves the slug server-side and passes the minimal
// `{ name, latitude, longitude }` payload in as `prefilledDestination`.
// Keep this file free of any import that pulls `lib/destinations/data`.
export interface PrefilledDestination {
  name: string;
  latitude: number;
  longitude: number;
}
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { prefs } from "@/lib/platform/storage";
import type { Activity, GeneratedItinerary, TripCreationParams, TripVibe, SeasonalContext } from "@/types";
// Step-1 components (above-the-fold) stay eager.
import VibeSelector from "@/components/trip/VibeSelector";
import SeasonalContextCard from "@/components/trip/SeasonalContextCard";
import DestinationAutocomplete, { PlacePrediction } from "@/components/ui/DestinationAutocomplete";
import DateRangePicker from "@/components/ui/DateRangePicker";
import StartAnywhereSection from "@/components/trip/StartAnywhereSection";
import { buildSeasonalContext, getSeasonalVibeSuggestions } from "@/lib/seasonal";
import { streamGeneration } from "@/lib/streaming/client";
import { MultiCityRouteBuilder, type RouteStop } from "@/components/trips/MultiCityRouteBuilder";
import { JourneyRibbon } from "@/components/trips/JourneyRibbon";
import { joinCities, addDaysISO } from "@/lib/ai/multi-city-core";

// Multi-city wedge (docs/MULTI_CITY_PLAN.md §2.5/§3.2). Env-gated so the default
// single-city funnel stays byte-for-byte unchanged until we flip the flag on.
const MULTI_CITY_ENABLED = process.env.NEXT_PUBLIC_MULTI_CITY_ENABLED === "true";

// Post-generation + modal UI is gated by user action / state — split it
// out of the initial wizard chunk so the form paints faster (P10).
const DestinationHero = dynamic(() => import("@/components/DestinationHero"), { ssr: false });
const ActivityCard = dynamic(() => import("@/components/ActivityCard"), { ssr: false });
const GenerationProgress = dynamic(() => import("@/components/trip/GenerationProgress"), { ssr: false });
const StartOverModal = dynamic(() => import("@/components/trip/StartOverModal"), { ssr: false });
const RegenerateButton = dynamic(() => import("@/components/trip/RegenerateButton"), { ssr: false });
// Export (PDF / iCal) on the anonymous result view. Client-only, no auth — works
// on the in-memory generatedItinerary. Discoverability audit 2026-07-01: the
// pre-save result had no export at all; only the saved trip page did.
const ExportMenu = dynamic(() => import("@/components/trip/ExportMenu"), { ssr: false });
// Read-only AI Q&A on the anonymous result (Tier 3-B1). Anon users at peak
// intent previously had no assistant — that lived only on the saved trip page.
const AnonAssistantPanel = dynamic(() => import("@/components/trip/AnonAssistantPanel"), { ssr: false });
const ValuePropositionBanner = dynamic(() => import("@/components/trip/ValuePropositionBanner"), { ssr: false });
const ShareAfterSaveModal = dynamic(() => import("@/components/trip/ShareAfterSaveModal"), { ssr: false });
const PublishTripModal = dynamic(() => import("@/components/explore/PublishTripModal"), { ssr: false });
const AuthPromptModal = dynamic(() => import("@/components/ui/AuthPromptModal"), { ssr: false });
const EarlyAccessModal = dynamic(() => import("@/components/ui/EarlyAccessModal"), { ssr: false });
const BetaCodeInput = dynamic(() => import("@/components/beta").then((m) => m.BetaCodeInput), { ssr: false });
const WaitlistSignup = dynamic(() => import("@/components/beta").then((m) => m.WaitlistSignup), { ssr: false });
// Note: useOnboardingPreferences removed - personalization moved to profile settings
import { useEarlyAccess } from "@/lib/hooks/useEarlyAccess";
import { useItineraryDraft, DraftRecoveryBanner } from "@/hooks/useItineraryDraft";
import { useCurrency } from "@/lib/locale";
import WizardReplay from "@/components/trip/WizardReplay";
import {
  trackItineraryGenerated,
  trackTripCreated,
  trackDestinationSelected,
  trackUpgradePromptShown,
  trackLimitReached,
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
} from "@/lib/posthog/events";
import type { TripWizardFieldInteractedEvent, TripIntent } from "@/lib/posthog/events";
import {
  captureSaveBlockedAnon,
  captureSaveFailed,
} from "@/lib/posthog/events";
import { handleTripCreatedWithReferral } from "@/lib/referral/client";
import { useFlag, useExperiment, usePostHog } from "@/lib/posthog";
import { FLAG_AUTO_SAVE_V1, FLAG_EXPLORE_UGC, FLAG_FRONT_DOOR } from "@/lib/posthog/flags";
import DecisionIntake from "@/components/wizard/DecisionIntake";
import { trackWizardEvent, type WizardEventStep, type FrontDoorArm } from "@/components/wizard/wizardEvents";
import { useAutoSaveTrip } from "@/hooks/useAutoSaveTrip";
import {
  insertTrip as persistInsertTrip,
  updateTrip as persistUpdateTrip,
  deleteTrip as persistDeleteTrip,
  attachCoverImage as persistAttachCoverImage,
  type TripFormState as PersistTripFormState,
  type PersistInput,
} from "@/lib/trips/persistTrip";

// Localized loading fallback for the lazy map. It renders inside the
// NextIntlClientProvider tree (it replaces TripMap in place while the chunk
// loads), so useTranslations resolves — unlike an inline literal at module
// scope, which can't reach the translation context and shipped raw English.
function MapLoadingFallback() {
  const t = useTranslations("trips");
  return (
    <div className="h-[350px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-400">{t("detail.loadingMap")}</span>
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
// en-dash so no English "to" (and no raw "2026-08-01") leaks on /it /es /pt.
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

// LOAD-BEARING: hoisted OUT of the component so the array identity is
// stable across renders. Was previously declared inside the component
// → new reference every render → trackFieldInteraction's [STEP_NAMES_CONST]
// dep changed every render → its useCallback recreated → handleVibesChange
// (which depends on it) recreated → VibeSelector's React.memo broken
// → step-2 vibe clicks tanked the renderer. Plus the abandonment-
// listener effect's [STEP_NAMES_CONST] dep re-fired on every render, tearing
// down + re-attaching window event listeners.
// Caught in docs/JOURNEY_AUDIT.md after the third-round live test.
const STEP_NAMES_CONST = ["destination_dates", "vibes_preferences"] as const;

// Server-side funnel mirror (trackWizardEvent + WizardEventStep) is hoisted to
// @/components/wizard/wizardEvents so BOTH this classic wizard and the
// decision-first arm (DecisionIntake) fire the SAME wizard_step_events funnel
// with a shared front_door arm tag. See app/api/wizard-event/route.ts + the
// 20260531 / 20260630 migrations. Imported at the top of this file.

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
}

export default function NewTripPage({ prefilledDestination }: NewTripWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("trips");
  // Locale is forwarded into the wizard_step_events rows so the funnel
  // can be sliced by language without joining back to URL paths. See
  // /api/wizard-event + the trackWizardEvent helper above.
  const locale = useLocale();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedItinerary, setGeneratedItinerary] = useState<GeneratedItinerary | null>(null);
  // Result-view UX state (parity with /trips/template/[id]).
  // **2026-05-24 live-test:** the result view had no map toggle and no
  // Cards/Timeline switcher. Added so users can hide the map (mobile
  // screen real estate) and pick the view they prefer.
  const [showMap, setShowMap] = useState(true);
  const [resultViewMode, setResultViewMode] = useState<"cards" | "timeline">("cards");
  // Streaming progress — set by the SSE consumer in handleGenerate. The
  // GenerationProgress component reads these to show real progress
  // ("Day 3 of 7") instead of fake-percentage phases.
  const [streamedDayCount, setStreamedDayCount] = useState(0);
  const [streamedTotalDays, setStreamedTotalDays] = useState(0);

  // Solo vs Group intent — pure measurement experiment added 2026-05-24
  // (docs/COLLAB_AUDIT.md "Phase 1: validate the bet"). Does NOT change
  // the wizard flow today. PostHog `trip_intent_selected` + the same
  // value forwarded on `trip_generation_started` / `_completed` tells
  // us:
  //   1. How many users actually want collab vs solo (raw distribution)
  //   2. Of group-intent users, what % go on to share/invite after save
  //
  // If <15% pick group, the homepage promise is over-claimed and we
  // should refocus on solo polish. If >30% pick group AND >50% share,
  // we have the signal to invest in the full group-first restructure.
  // "unspecified" = user clicked Continue without touching the toggle.
  const [tripIntent, setTripIntent] = useState<TripIntent>("unspecified");

  // Auth state for gradual engagement — task #181: read auth from the
  // single AuthProvider instead of running our own getUser() listener.
  // isAuthenticated keeps its existing tri-state shape (null=loading,
  // true/false otherwise) so the downstream JSX gating doesn't change.
  const { user: authUser, loading: authLoading } = useAuth();
  const isAuthenticated: boolean | null = authLoading ? null : !!authUser;

  // Front-door A/B (flag: "front-door"). Anon-only: authed users are forced to
  // the classic wizard. Tri-state safe: only a DEFINITIVELY anonymous user
  // (isAuthenticated === false) in the explicit "decision" variant gets the
  // decision arm; loading auth (null), loading flag (undefined), authed (true),
  // and control ("wizard") all resolve to "wizard", so the classic wizard paints
  // first (v1 accepts this first-paint flicker — plan §"Accept first-paint
  // flicker"). A `?front_door=wizard|decision` query param overrides the
  // assignment (the DecisionIntake escape hatch + QA force-preview).
  const frontDoorOverride = searchParams.get("front_door");
  const { variant: frontDoorVariant } = useExperiment(FLAG_FRONT_DOOR);
  const arm: FrontDoorArm =
    frontDoorOverride === "wizard"
      ? "wizard"
      : frontDoorOverride === "decision"
        ? "decision"
        : isAuthenticated === false && frontDoorVariant === "decision"
          ? "decision"
          : "wizard";
  // Stable ref so the once-attached abandonment listener reads the current arm
  // instead of a stale mount-time closure.
  const armRef = useRef<FrontDoorArm>(arm);
  useEffect(() => {
    armRef.current = arm;
  }, [arm]);
  // Tag every PostHog capture() + $pageview with the arm as a super-property so
  // the whole PostHog funnel is arm-sliceable with no per-call edits. The
  // Supabase wizard_step_events sink is tagged separately via trackWizardEvent's
  // 3rd arg. posthog may be undefined before init (lazy-loaded) — guard + re-run
  // when it resolves.
  const posthog = usePostHog();
  useEffect(() => {
    if (!posthog) return;
    posthog.register({ front_door: arm });
  }, [posthog, arm]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [hasExistingTrips, setHasExistingTrips] = useState(false);
  const [showReturningUserBanner, setShowReturningUserBanner] = useState(true);

  // Note: Onboarding/personalization preferences are now managed in profile settings
  // The AI generation API fetches user preferences from the database instead

  // Early access gate
  const {
    showModal: showEarlyAccessModal,
    setShowModal: setShowEarlyAccessModal,
    redeemCode,
    error: earlyAccessError,
    refresh: refreshEarlyAccess,
  } = useEarlyAccess();
  const [pendingGeneration, setPendingGeneration] = useState(false);
  const [showInlineLimitPrompt, setShowInlineLimitPrompt] = useState(false);
  const [limitReachedMessage, setLimitReachedMessage] = useState<string | null>(null);

  // Form state
  const [destination, setDestination] = useState("");
  const [destinationCoords, setDestinationCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  // Multi-city wedge: a route of city+nights rows. Only surfaced in step 1 when
  // MULTI_CITY_ENABLED; a sync effect below keeps `destination`/`endDate`
  // consistent so the rest of the wizard flow is untouched.
  const [multiCityMode, setMultiCityMode] = useState(false);
  const [cityRows, setCityRows] = useState<RouteStop[]>([
    { city: "", nights: 3 },
    { city: "", nights: 2 },
  ]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budgetTier, setBudgetTier] = useState<"budget" | "balanced" | "premium">("balanced");
  // Backpacker Mode — shipped 2026-05-28. Default "classic" matches all
  // existing flows; when toggled to "backpacker" we (a) auto-set budget
  // to "budget" if it's not already, (b) pass travelStyle through to the
  // generate API so Gemini gets the backpacker directive, (c) persist
  // travel_style into trip_meta. See docs and Hostelworld partnership wedge.
  const [travelStyle, setTravelStyle] = useState<"classic" | "backpacker">("classic");
  const [pace, setPace] = useState<"relaxed" | "moderate" | "active">("moderate");
  const [selectedVibes, setSelectedVibes] = useState<TripVibe[]>([]);
  const [requirements, setRequirements] = useState("");
  const [seasonalContext, setSeasonalContext] = useState<SeasonalContext | null>(null);

  // UX enhancement state
  const [showStartOverModal, setShowStartOverModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showDraftRecovery, setShowDraftRecovery] = useState(false);
  const [draftAutoRestored, setDraftAutoRestored] = useState(false);

  // Post-save sharing modal state (critical for virality)
  const [showShareAfterSaveModal, setShowShareAfterSaveModal] = useState(false);
  const [savedTripId, setSavedTripId] = useState<string | null>(null);
  // Publish-to-Explore auto-prompt state. Wired into ShareAfterSaveModal's
  // onPublish callback. Owner clicks → share modal closes → publish modal
  // opens with their author name prefilled. See onPublish handler below.
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [authedDisplayName, setAuthedDisplayName] = useState<string>("");

  // LocalStorage draft persistence
  const { draft, saveDraft, clearDraft, hasDraft } = useItineraryDraft();

  // Currency conversion hook - converts prices to user's preferred currency
  const { convert: convertCurrency } = useCurrency();

  // Streamlined 2-step wizard: Destination+Dates -> Vibes+Preferences
  // Reduced from 4 steps to cut drop-off by 50% (PostHog data: 76% activation drop-off)
  const TOTAL_STEPS = 2;

  // STEP_NAMES_CONST is hoisted to module scope above the component
  // — see the load-bearing comment there. Don't redeclare it here.

  // Collapsible preferences state (budget/pace/requirements shown on demand in step 2)
  const [showAdvancedPrefs, setShowAdvancedPrefs] = useState(false);
  // Day-4 bug fix (P2.6): trackWizardEvent was firing 2-3× per page
  // load because the dep-only-[step] effect re-runs on React 19 dev
  // StrictMode double-mount AND on any client-side remount (back nav,
  // Start Over, draft-recovery setState). PostHog dedupes server-side
  // so captureTripWizardStepViewed was clean, but Supabase has no
  // dedupe → wizard_step_events accumulated 2-3 rows per actual step
  // view, inflating step_1 by ~3× and under-stating funnel conversion.
  // Mirrors the ref-guard pattern already used for abandonedFiredRef
  // and wizardCompletedRef below.
  const trackedStepsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    captureTripWizardStepViewed({
      step_number: step,
      step_name: STEP_NAMES_CONST[step - 1],
    });
    // Mirror the step view into Supabase. Step 1 fires `step_1_*`,
    // step 2 fires `step_2_vibes`. This is the entry-point event for
    // each step — downstream events (generating/result/save_clicked/
    // saved/abandoned) are fired from their own handlers. `locale` is
    // included on step 1 only because it's the only field guaranteed
    // to be meaningful at that point.
    //
    // Gate on trackedStepsRef so we fire exactly once per step per
    // wizard mount lifetime. Step transitions (1→2→1) still re-fire
    // because the Set is per-component-instance; a true full remount
    // (route nav) resets the ref, which is correct — that's a new
    // session view.
    if (trackedStepsRef.current.has(step)) {
      return;
    }
    trackedStepsRef.current.add(step);
    if (step === 1) {
      void trackWizardEvent("step_1_destination_dates", { locale }, arm);
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
      }, arm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Wizard funnel diagnostics ────────────────────────────────────────────
  // Goal: pinpoint which field on /trips/new is killing the funnel. Today
  // we know 96% of sessions that view step 1 never complete it. We don't
  // know if they (a) didn't engage at all, (b) typed a destination but
  // bailed on the date picker, (c) etc. These refs + the abandonment
  // listener give us the answer.

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
  // (Surfaced 2026-06-01 from paul.harrington@hostelworld.com — 2 identical
  // Warsaw trips saved 4 seconds apart on signup.)
  const savingTripRef = useRef<boolean>(false);

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
  //
  // **Refactored (task #152/#167):** slug resolution against the curated
  // destinations dataset (`lib/destinations/data.ts`, ~477 KB) now happens
  // server-side in `page.tsx`. If the slug matched a known destination we
  // receive `prefilledDestination` already resolved; otherwise we fall
  // back to the raw `?destination=` value as free text (capitalize +
  // pass-through, coords filled in by autocomplete on confirm).
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

  // Memoized VibeSelector handler so the child's React.memo can actually
  // short-circuit. Caught in LIVE_AUDIT B5 — without this the new
  // function identity on every parent render bust memoization and made
  // step 2 expensive to re-render.
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
      // (session_id, step) without name translation. Task #293.
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
      }, armRef.current);
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

  // Existing-trips check — task #181: auth state itself flows from the
  // central AuthProvider above. We only need this effect for the trips
  // count, which gets re-evaluated whenever the user resolves or changes.
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
  // The `pendingTripGeneration` flag now lives in `prefs` (durable on
  // iOS WebView, was getting evicted under ITP / storage pressure as
  // plain localStorage) — read is async, so we wrap in an inner fn
  // and gate the side effect on the still-current cleanup state.
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
  // Uses latitude for accurate hemisphere detection (fixes Southern Hemisphere bug).
  //
  // **Bug #294 (2026-05-31)** — investigated as the suspected cause of the
  // wizard freeze on autocomplete destination select. Verdict: NOT the cause.
  // `buildSeasonalContext` is pure-synchronous regex + ~50-entry table lookup,
  // runs in well under 1ms; live repro on /trips/new clocked the entire
  // autocomplete-click handler chain at 68ms sync + one 159ms long task,
  // with no `buildSeasonalContext` call at all on the click path (this effect
  // short-circuits to setSeasonalContext(null) when startDate is empty, which
  // it always is at autocomplete-select time).
  //
  // **Defensive change kept from the investigation:** defer the synchronous
  // setState into a microtask via queueMicrotask. The seasonal context only
  // feeds non-critical UI (the post-dates SeasonalContextCard + the vibe-
  // suggestion seed on Continue) — never block an interaction frame on it.
  // If the lib ever grows (e.g. fetched holidays, weather lookup) this guard
  // keeps the interaction handler responsive.
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

  // Check for unsaved draft on mount - AUTO-RESTORE if coming back from auth.
  // The `pendingTripGeneration` flag lives in `prefs` (async on native
  // Capacitor) — wrap the read in an inner async fn and use `cancelled`
  // so we don't set state after unmount / dep change.
  useEffect(() => {
    if (!hasDraft || !draft || generatedItinerary || draftAutoRestored) return;

    let cancelled = false;

    (async () => {
      // Check if we're coming back from auth with pending generation
      const hasPendingGeneration = (await prefs.get("pendingTripGeneration")) === "true";
      if (cancelled) return;

      if (hasPendingGeneration) {
        // Auto-restore the draft silently (no banner) for seamless post-auth experience.
        // **2026-05-25 P0 fix**: previously only restored form state and dropped
        // `draft.generatedItinerary`, then the useEffect at line ~380 would see
        // !generatedItinerary and re-call handleGenerate(), producing a DIFFERENT
        // itinerary than the one the user just saw and clicked Save on. Result:
        // the trip the user intended to save was silently replaced. Now we
        // restore the itinerary too so handleGenerate is NOT re-run and the
        // post-auth Save Trip click persists the original itinerary.
        setDestination(draft.destination);
        setStartDate(draft.startDate);
        setEndDate(draft.endDate);
        setPace(draft.pace as "relaxed" | "moderate" | "active");
        setSelectedVibes(draft.vibes as TripVibe[]);
        setBudgetTier(draft.budgetTier as "budget" | "balanced" | "premium");
        // travelStyle may be undefined on pre-2026-05-28 drafts → "classic"
        if (draft.travelStyle === "backpacker") {
          setTravelStyle("backpacker");
        }
        if (draft.generatedItinerary) {
          setGeneratedItinerary(draft.generatedItinerary);
        }
        // Don't restore coordinates - they'll be re-fetched if needed
        setDraftAutoRestored(true);
        // Don't show the banner since we're auto-restoring
      } else {
        // Normal draft recovery - show banner to let user choose
        setShowDraftRecovery(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasDraft, draft, generatedItinerary, draftAutoRestored]);

  // Auto-save draft when itinerary is generated
  useEffect(() => {
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
      });
    }
  }, [generatedItinerary, destination, startDate, endDate, pace, selectedVibes, budgetTier, travelStyle, saveDraft]);

  // ── Auto-save trip orchestration (gated by auto-save-v1 PostHog flag) ────
  // The hook owns the save state machine — INSERT-or-UPDATE decision,
  // the in-flight save promise (so regenerate can await it), error
  // surfacing, and the discard path. See hooks/useAutoSaveTrip.ts.
  // useFlag returns `boolean | undefined` while PostHog is still loading
  // — coerce to a strict boolean so the hook's "off by default" semantics
  // are explicit (no auto-save until the flag has actually evaluated).
  const { enabled: autoSaveEnabledRaw } = useFlag(FLAG_AUTO_SAVE_V1);
  const autoSaveEnabled = autoSaveEnabledRaw === true;
  // Explore-UGC gate for the post-save Publish CTA. The PostHog flag
  // mirrors the server-side EXPLORE_UGC_ENABLED env (server is the source
  // of truth — the publish API itself 404s when env is off). We use the
  // client flag only to hide the button when the user isn't in the cohort,
  // so we don't surface a CTA that would silently fail.
  const { enabled: exploreUgcFlagRaw } = useFlag(FLAG_EXPLORE_UGC);
  const exploreUgcEnabled = exploreUgcFlagRaw === true;

  const autoSaveFormState: PersistTripFormState = {
    destination,
    startDate,
    endDate,
    budgetTier,
    pace,
    vibes: selectedVibes,
    derivedInterests: deriveInterestsFromVibes(),
    travelStyle,
  };

  const autoSaveTrip = useCallback(async (input: PersistInput) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    return persistInsertTrip(supabase, input, user.id);
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
        // GA4 + referral + bananas + side-effects (mirrors the legacy
        // handleSaveTrip post-insert block).
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
        // Task #293.
        void trackWizardEvent("saved", {
          destination,
          duration_days: durationDays,
          group_size: tripIntent,
          backpacker_mode: travelStyle === "backpacker",
          locale,
        }, arm);
        // Fire first_trip_saved unconditionally — same rationale as the
        // manual handleSaveTrip path (Task #319, 2026-05-31). Both save
        // paths emit the event so cohort math works regardless of which
        // flow the user falls through.
        try {
          captureFirstTripSaved({
            trip_id: tripId,
            destination,
            duration_days: durationDays,
            time_to_value_minutes: 0,
            from_template: false,
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
        clearDraft();
        if (typeof window !== "undefined") {
          sessionStorage.setItem("profile_modal_shown", "true");
        }
        // Post-save virality prompt. The manual-save trigger
        // (setShowShareAfterSaveModal at ~1581) lives inside the AUTHED branch
        // of handleSaveTrip, which the anon->activated cohort never reaches:
        // they hit the auth wall, sign up, and return to be persisted HERE by
        // the auto-save effect — so the whole invite/publish loop was dead for
        // exactly the cohort we want to activate. Open it on first insert. Set
        // savedTripId directly so the modal's redirects have it immediately
        // (the mirror effect at ~894 also sets it). Guard to once/session so a
        // Start-Over -> new insert doesn't nag.
        setSavedTripId(tripId);
        if (typeof window !== "undefined" && !sessionStorage.getItem("share_after_save_shown")) {
          sessionStorage.setItem("share_after_save_shown", "true");
          setShowShareAfterSaveModal(true);
        }
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

  const autoSave = useAutoSaveTrip({
    itinerary: generatedItinerary,
    isAuthenticated,
    enabled: autoSaveEnabled,
    formState: autoSaveFormState,
    saveTrip: autoSaveTrip,
    updateTrip: autoUpdateTrip,
    deleteTrip: autoDeleteTrip,
    attachCoverImage: autoAttachCoverImage,
    onPersisted: handlePersisted,
  });

  // Mirror the auto-save trip id into the existing savedTripId state so
  // ShareAfterSaveModal + Sticky Bottom Bar continue to read it from one
  // place. setState is a no-op when values are equal.
  useEffect(() => {
    if (autoSave.savedTripId && autoSave.savedTripId !== savedTripId) {
      setSavedTripId(autoSave.savedTripId);
    }
    if (!autoSave.savedTripId && savedTripId && autoSaveEnabled) {
      // discarded
      setSavedTripId(null);
    }
  }, [autoSave.savedTripId, savedTripId, autoSaveEnabled]);

  // Handle draft restoration
  const handleRestoreDraft = () => {
    if (draft) {
      setDestination(draft.destination);
      setStartDate(draft.startDate);
      setEndDate(draft.endDate);
      setPace(draft.pace as "relaxed" | "moderate" | "active");
      setSelectedVibes(draft.vibes as TripVibe[]);
      setBudgetTier(draft.budgetTier as "budget" | "balanced" | "premium");
      if (draft.travelStyle === "backpacker") {
        setTravelStyle("backpacker");
      }
      setGeneratedItinerary(draft.generatedItinerary);
      setShowDraftRecovery(false);
    }
  };

  // Handle draft discard
  const handleDiscardDraft = () => {
    clearDraft();
    setShowDraftRecovery(false);
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

    // Re-trigger generation
    await handleGenerate();
    setIsRegenerating(false);
  };

  // Handle start over - confirmed discard.
  //
  // 2026-06-07: signature changed to accept the reason + optional custom
  // text from the StartOverModal (the david-cassoni postmortem). We POST
  // the feedback to /api/trips/[id]/deletion-feedback BEFORE the
  // soft-delete so we still capture the WHY even if the discard itself
  // hiccups. The feedback row is independently useful — even without a
  // matching tombstone we learn what drove regret.
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

    // If auto-save persisted a row, soft-delete it (post commit 8d8f591:
    // UPDATE deleted_at) before resetting state so the user doesn't end
    // up with an orphaned trip in their dashboard. The row stays in the
    // DB tombstoned — recoverable for 7 days via SQL.
    if (wasAutoSaved) {
      await autoSave.discard();
    }
    clearDraft();
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
    setSeasonalContext(null);
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

  const canProceed = () => {
    switch (step) {
      case 1:
        // Step 1: Destination + Dates combined
        return destination.length >= 2 && startDate && endDate && new Date(endDate) >= new Date(startDate);
      case 2:
        // Step 2: At least one vibe required, preferences have sensible defaults
        return selectedVibes.length > 0;
      default:
        return false;
    }
  };

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

  const handleGenerate = async () => {
    // **2026-05-23**: Anonymous generation enabled. Visitors generate first,
    // sign up later (at Save). The /api/ai/generate route accepts anonymous
    // requests rate-limited by cookie (2/24h). Persisting the form draft to
    // localStorage stays — it lets us recover gracefully if the visitor
    // closes the tab mid-generation, AND it's what survives the eventual
    // signup modal at Save time.
    if (destination && startDate && endDate) {
      saveDraft({
        generatedItinerary: null as unknown as GeneratedItinerary,
        destination,
        startDate,
        endDate,
        pace,
        vibes: selectedVibes,
        budgetTier,
        travelStyle,
      });
    }

    setGenerating(true);
    setError(null);

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
      // Forward the Phase-1 intent signal so PostHog funnels can filter
      // "started generation" by intent (solo vs group) and downstream
      // share/save rates.
      trip_intent: tripIntent,
    });
    // Supabase mirror — fired alongside the PostHog event so the funnel
    // is queryable in SQL. Task #293.
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
    }, arm);

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
        travelStyle,
        ...(isMultiCity ? { destinations: mcLegs! } : {}),
      };

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
      // Multi-city returns one merged JSON body, not an SSE stream — skip the
      // streaming endpoint and let the JSON fallback below carry `destinations`.
      if (!isMultiCity) try {
        await streamGeneration(
          params,
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
      //    deliver a final itinerary. Three cases get us here:
      //      (a) streamGeneration() threw before any events (rate-limit,
      //          dev-key revoked, network 5xx) — caught above.
      //      (b) it completed without a `complete` event (rare).
      //      (c) the server emitted HTTP 200 then an SSE `error` event
      //          mid-flight (transient Gemini upstream blip, parser
      //          exception, model overload). 2026-05-31 audit fix
      //          (Task #310): previously we threw on `streamError`
      //          BEFORE this fallback, hard-failing every transient
      //          upstream blip even though the JSON route has cache
      //          hits + a graceful LIMIT_REACHED UI gate. Now we let
      //          the fallback run; only re-throw if the JSON path
      //          ALSO fails to produce an itinerary.
      let data: { itinerary?: GeneratedItinerary; usage?: { used?: number; limit?: number }; code?: string; error?: string };
      if (streamedItinerary) {
        data = { itinerary: streamedItinerary };
      } else {
        const response = await fetch("/api/ai/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        data = await response.json();

        if (!response.ok) {
          // Check for early access gate
          if (data.code === "NO_ACCESS" || data.code === "LIMIT_REACHED") {
            setPendingGeneration(true);
            setShowInlineLimitPrompt(true);
            setLimitReachedMessage(data.error || "You've reached your usage limit");
            trackLimitReached({
              limitType: "generation",
              currentUsage: data.usage?.used || 0,
              limit: data.usage?.limit || 3,
            });
            trackUpgradePromptShown({
              trigger: "limit_reached",
              limitType: "generation",
              location: "trip_creation",
            });
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

      // Supabase funnel mirror — fired only when we actually have an
      // itinerary to render. Task #293.
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
        }, arm);
        // Shared cross-arm first-value (itinerary-level). The decision arm fires
        // its own earlier first_value at options_shown, so gate this to the
        // classic wizard to keep one first_value per arm per session.
        if (arm === "wizard") {
          void trackWizardEvent("first_value", {
            destination,
            duration_days: durationDaysResult,
            locale,
          }, arm);
        }
      }

      // Track successful itinerary generation.
      // Bug-bounty 2026-05-24 P1: previously `Date.now() - performance.now()`
      // which is Unix-epoch minus page-life-ms — a giant nonsense
      // number (~1.7 trillion). All historical generation_time_ms
      // analytics through GA4 + PostHog have been wrong since launch.
      // Use the actual start time of THIS generation request.
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
    // is set, but a child component (DestinationHero onSave at line 1200)
    // could still invoke it.
    if (autoSaveEnabled && autoSave.savedTripId) return;
    // Synchronous re-entry guard: setLoading(true) below is async, and a
    // user can click a second time in the gap before React re-renders the
    // disabled button. The ref check fires before any state update lands.
    if (savingTripRef.current) return;
    savingTripRef.current = true;

    // Supabase funnel mirror — fired on the user's Save tap regardless
    // of auth state. This captures the "peak intent" event before the
    // auth modal potentially intercepts. Task #293.
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
    }, arm);

    setLoading(true);
    try {
      // Task #181: read auth from the central AuthProvider rather than
      // firing another getUser() round-trip. The subsequent supabase
      // INSERT below still goes through the per-request client (RLS will
      // re-verify the session on the wire).
      const user = authUser;
      const supabase = createClient();

      if (!user) {
        // **2026-05-23**: This is now the auth wall (moved from Generate).
        // The user just saw their generated itinerary and clicked Save —
        // peak motivation, the right moment to ask for an account. The
        // existing draft logic (saveDraft + pendingTripGeneration flag)
        // already persists the trip so it'll be restored after signup.
        if (generatedItinerary) {
          saveDraft({
            generatedItinerary,
            destination,
            startDate,
            endDate,
            pace,
            vibes: selectedVibes,
            budgetTier,
          });
        }
        // Funnel disambiguation: save_clicked > saved is the dominant
        // "lost intent" leak. Without this event we can't tell "user
        // bounced at auth wall" from "save genuinely errored". Surfaced
        // 2026-06-02 — 1 save_clicked, 0 saved, 0 signups in one day made
        // the gap invisible until manual investigation.
        void trackWizardEvent("save_blocked_anon", {
          destination,
          group_size: tripIntent,
          backpacker_mode: travelStyle === "backpacker",
          locale,
        }, arm);
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
        weather_note: generatedItinerary.destination.weather_note,
        highlights: generatedItinerary.trip_summary.highlights,
        booking_links: generatedItinerary.booking_links,
        destination_best_for: generatedItinerary.destination.best_for,
        packing_suggestions: generatedItinerary.trip_summary.packing_suggestions,
      };

      // Server-side dedupe (defense in depth): before INSERT, check if the
      // same user already saved a trip with the same title + start_date in
      // the last 60s. If so, reuse it. RLS scopes this SELECT to the
      // caller's own trips so no privacy leak. Catches:
      //   - cross-tab double-save (client ref doesn't share across tabs)
      //   - hard-refresh-then-resave (ref reset, draft still present)
      //   - any client guard regression
      const tripTitle = `${generatedItinerary.destination.name} Trip`;
      const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
      const { data: existingTrip } = await supabase
        .from("trips")
        .select("id")
        .eq("user_id", user.id)
        .eq("title", tripTitle)
        .eq("start_date", startDate)
        .gte("created_at", sixtySecondsAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let trip: { id: string };
      if (existingTrip) {
        // Reuse the row that already landed. Treat as a successful save.
        trip = existingTrip;
      } else {
        const { data: inserted, error: tripError } = await supabase
          .from("trips")
          .insert({
            user_id: user.id,
            title: tripTitle,
            description: generatedItinerary.destination.description,
            start_date: startDate,
            end_date: endDate,
            status: "planning",
            visibility: "private",
            itinerary: generatedItinerary.days,
            cover_image_url: coverImageUrl,
            budget: {
              total: generatedItinerary.trip_summary.total_estimated_cost,
              spent: 0,
              currency: generatedItinerary.trip_summary.currency,
            },
            tags: deriveInterestsFromVibes(), // Auto-derived from vibes
            trip_meta: tripMeta, // Preserve AI-generated metadata
            packing_list: generatedItinerary.trip_summary.packing_suggestions, // Also store in packing_list column
          })
          .select()
          .single();

        if (tripError) throw tripError;
        trip = inserted;
      }

      // Calculate trip duration
      const durationDays = Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

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
      // below so both flows reach this terminal funnel state. Task #293.
      void trackWizardEvent("saved", {
        destination,
        duration_days: durationDays,
        group_size: tripIntent,
        backpacker_mode: travelStyle === "backpacker",
        locale,
      }, arm);

      // Fire first_trip_saved unconditionally (organic + referred). Was
      // gated inside handleTripCreatedWithReferral on wasReferred — so
      // organic users (the bulk of saves) never produced the event.
      // Dup-firing on a 2nd save is acceptable cost for full cohort
      // coverage; the event name is aspirational, the data is what
      // matters for PMF analysis (Task #319, 2026-05-31).
      try {
        captureFirstTripSaved({
          trip_id: trip.id,
          destination,
          duration_days: durationDays,
          time_to_value_minutes: 0, // signup-time not threaded here
          from_template: false,
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

      // Clear draft on successful save
      clearDraft();

      // Prevent ProfileCompletionModal from showing after trip creation
      // Users just completed a complex flow, don't interrupt with another modal
      if (typeof window !== "undefined") {
        sessionStorage.setItem("profile_modal_shown", "true");
      }

      // Capture display name for the Publish-to-Explore prefill (best-
      // effort: user_metadata > email local-part > empty). Falls back to
      // "Anonymous traveler" inside PublishTripModal if both miss.
      try {
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
        const candidate =
          (typeof meta.full_name === "string" && meta.full_name) ||
          (typeof meta.name === "string" && meta.name) ||
          (user.email ? user.email.split("@")[0] : "");
        if (candidate) setAuthedDisplayName(String(candidate).slice(0, 80));
      } catch {
        /* non-fatal */
      }

      // Show sharing prompt instead of immediate redirect (critical for virality)
      setSavedTripId(trip.id);
      setShowShareAfterSaveModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trip");
      // Funnel marker: this is the AUTHED-save genuine-failure path
      // (INSERT errored, RLS rejected, network died, etc). Distinct from
      // save_blocked_anon (anon user dismissed auth modal). If this fires
      // even once in a 2h watcher window we want to wake up — it means
      // a real user lost a real trip after a real save click.
      void trackWizardEvent("save_failed", {
        destination,
        group_size: tripIntent,
        backpacker_mode: travelStyle === "backpacker",
        locale,
      }, arm);
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

  // Apply an anonymous-assistant day edit to the in-memory itinerary. Recomputes
  // the trip total (delta) so hero/sticky/overview/export/saved-budget stay in
  // sync, carries map data + stable ids over by name-match, and scrolls the
  // changed day into view. Nothing is persisted until the user saves.
  const handleApplyDayEdit = useCallback(
    (dayNumber: number, newActivities: Activity[], theme?: string) => {
      setGeneratedItinerary((prev) => {
        if (!prev) return prev;
        const target = prev.days.find((d) => d.day_number === dayNumber);
        const byName = new Map(
          (target?.activities ?? []).map((a) => [a.name.trim().toLowerCase(), a])
        );
        const merged: Activity[] = newActivities.map((a, i) => {
          const match = byName.get(a.name.trim().toLowerCase());
          return {
            ...a,
            id:
              match?.id ??
              a.id ??
              `edit-${dayNumber}-${i}-${a.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .slice(0, 40)}`,
            coordinates: a.coordinates ?? match?.coordinates,
            address: a.address ?? match?.address,
            image_url: a.image_url ?? match?.image_url,
          };
        });
        const sum = (acts: Activity[]) =>
          acts.reduce((s, a) => s + (a.estimated_cost?.amount || 0), 0);
        const prevTotal = prev.trip_summary?.total_estimated_cost || 0;
        const newTotal = Math.max(
          0,
          Math.round(prevTotal - (target ? sum(target.activities) : 0) + sum(merged))
        );
        return {
          ...prev,
          days: prev.days.map((d) =>
            d.day_number === dayNumber
              ? { ...d, activities: merged, ...(theme ? { theme } : {}) }
              : d
          ),
          trip_summary: { ...prev.trip_summary, total_estimated_cost: newTotal },
        };
      });
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

  // Show generated itinerary
  if (generatedItinerary) {
    const fullDestination = `${generatedItinerary.destination.name}, ${generatedItinerary.destination.country}`;
    // Multi-city: derive the route stops (city + consecutive nights) from the
    // city-tagged days for the Journey ribbon. Empty on single-city trips.
    const mcStops: { city: string; nights: number }[] = [];
    for (const day of generatedItinerary.days) {
      if (!day.city) continue;
      const last = mcStops[mcStops.length - 1];
      if (last && last.city === day.city) last.nights += 1;
      else mcStops.push({ city: day.city, nights: 1 });
    }

    // Calculate total activities for modal
    const totalActivities = generatedItinerary.days.reduce((acc, day) => acc + day.activities.length, 0);

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white pb-24 sm:pb-8">
        {/* Start Over Modal */}
        <StartOverModal
          isOpen={showStartOverModal}
          onClose={() => setShowStartOverModal(false)}
          onConfirm={handleStartOver}
          destination={fullDestination}
          tripDays={generatedItinerary.days.length}
          activitiesCount={totalActivities}
          wasAutoSaved={autoSaveEnabled && Boolean(autoSave.savedTripId)}
        />

        {/* Share After Save Modal - Critical for virality */}
        <ShareAfterSaveModal
          isOpen={showShareAfterSaveModal}
          onClose={() => {
            setShowShareAfterSaveModal(false);
            if (savedTripId) {
              router.push(`/trips/${savedTripId}`);
            }
          }}
          onInvite={() => {
            setShowShareAfterSaveModal(false);
            if (savedTripId) {
              // Redirect with query param to auto-open share modal
              router.push(`/trips/${savedTripId}?share=invite`);
            }
          }}
          // Only expose the publish CTA when /explore is reachable for
          // this user — flag mirrors the server gate, so hiding the
          // button avoids a CTA that would 404 on submit.
          onPublish={
            exploreUgcEnabled && savedTripId
              ? () => {
                  setShowShareAfterSaveModal(false);
                  setShowPublishModal(true);
                }
              : undefined
          }
          tripId={savedTripId || ""}
          tripTitle={`${generatedItinerary.destination.name} Trip`}
          tripDays={generatedItinerary.days.length}
          destination={fullDestination}
        />

        {/* Publish-to-Explore modal — chained off the ShareAfterSaveModal
            "Publish" CTA. Stays mounted (cheap, dynamic) so React preserves
            the user's typed authorName/Note across reopen. On close we send
            the user to /trips/[id] regardless of outcome (same destination
            as the share modal's skip path) so the post-save journey ends
            somewhere coherent. On successful publish, jump straight to
            /explore so the user immediately sees their card live. */}
        {savedTripId && (
          <PublishTripModal
            tripId={savedTripId}
            isOpen={showPublishModal}
            defaultAuthorName={authedDisplayName}
            onClose={() => {
              setShowPublishModal(false);
              router.push(`/trips/${savedTripId}`);
            }}
            onPublished={() => {
              setShowPublishModal(false);
              router.push("/explore");
            }}
          />
        )}

        {/* Auth Prompt Modal — anonymous user clicks Save Trip on the
            generated itinerary.
            **2026-05-24 P0**: Previously only rendered in the wizard-form
            return block (line ~1574), so setShowAuthModal(true) from
            handleSaveTrip set state on a modal that was never mounted.
            Result: anonymous Save Trip click was a dead button — peak
            conversion moment, completely broken. */}
        <AuthPromptModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          destination={destination}
        />

        {/* Hero with Cover Image */}
        <DestinationHero
          destination={fullDestination}
          title={fullDestination}
          subtitle={generatedItinerary.destination.description}
          dateRange={formatDateRangeLocalized(startDate, endDate, locale)}
          budget={{
            total: generatedItinerary.trip_summary.total_estimated_cost,
            currency: generatedItinerary.trip_summary.currency,
          }}
          days={generatedItinerary.days.length}
          tags={generatedItinerary.destination.best_for}
          showBackButton={false}
        />

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
              {/* Export (PDF / iCal) — desktop sticky header only (this bar is
                  hidden sm:block; mobile export is a follow-up since ExportMenu's
                  dropdown opens downward and would clip in the fixed bottom bar). */}
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
              <RegenerateButton
                onRegenerate={handleRegenerate}
                isRegenerating={isRegenerating || generating}
                variant="compact"
              />
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
                  className="bg-[var(--secondary)] text-white px-6 py-2.5 rounded-xl font-medium opacity-60 shadow-lg shadow-[var(--secondary)]/25 flex items-center gap-2"
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
                // Legacy flow (flag off): manual Save Trip button.
                <button
                  onClick={handleSaveTrip}
                  disabled={loading}
                  className="bg-[var(--secondary)] text-white px-6 py-2.5 rounded-xl font-medium hover:bg-[var(--secondary)]/90 transition-colors disabled:opacity-50 shadow-lg shadow-[var(--secondary)]/25 flex items-center gap-2"
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
            </div>
          </div>
        </div>

        {/* Mobile Sticky Bottom Bar */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 px-4 py-3 sm:hidden safe-area-inset-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
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
              onRegenerate={handleRegenerate}
              isRegenerating={isRegenerating || generating}
              variant="icon-only"
              className="flex-shrink-0"
            />

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
                className="flex-1 bg-[var(--secondary)] text-white py-3 rounded-xl font-semibold opacity-60 shadow-lg shadow-[var(--secondary)]/25 flex items-center justify-center gap-2"
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
                className="flex-1 bg-[var(--secondary)] text-white py-3 rounded-xl font-semibold transition-colors disabled:opacity-50 shadow-lg shadow-[var(--secondary)]/25 flex items-center justify-center gap-2"
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
          {/* Save/generation error — previously rendered only in the form view,
              so an authed Save failure looked like a dead button here. Restores
              feedback at peak intent (enhancement hunt). */}
          {error && (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {error}
            </div>
          )}
          {/* AI assistant — Q&A + day-scoped edits at peak intent (Tier 3-B1/B2). */}
          <div className="mb-8">
            <AnonAssistantPanel
              destination={fullDestination}
              tripTitle={`${generatedItinerary.destination.name} Trip`}
              days={generatedItinerary.days}
              startDate={startDate}
              endDate={endDate}
              onApplyDay={handleApplyDayEdit}
            />
          </div>

          {/* Interactive Map + View Controls */}
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">{t("wizard.result.tripOverview")}</h2>
                <span className="text-sm text-slate-500 line-clamp-2 sm:line-clamp-1">
                  {generatedItinerary.destination.weather_note}
                </span>
              </div>

              {/* View-mode + map toggles — added 2026-05-24 for parity with
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
                  // **2026-05-24 live-test fix:** map pin click → scroll
                  // to the matching activity card. The InfoWindow "View
                  // Details" button calls this; ActivityCard exposes a
                  // stable `id` attribute we target here.
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
                      <ActivityCard
                        key={idx}
                        activity={activity}
                        index={idx}
                        currency={generatedItinerary.trip_summary.currency}
                        showGallery={true}
                      />
                    ))}
                  </div>
                ) : (
                  // Compact vertical-rail Timeline view (ported from
                  // /trips/template/[id] for parity). Easier to skim than
                  // full Cards — no images, just time/title/location.
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
              onRegenerate={handleRegenerate}
              isRegenerating={isRegenerating || generating}
              variant="default"
            />
          </div>
        </main>
      </div>
    );
  }

  // Inline limit prompt - shown instead of modal when user hits usage limit
  if (showInlineLimitPrompt) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-amber-50/30">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
            <button
              onClick={() => {
                setShowInlineLimitPrompt(false);
                setPendingGeneration(false);
                setLimitReachedMessage(null);
              }}
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 px-2 py-1.5 -ml-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">{t("wizard.back")}</span>
            </button>
            <span className="font-semibold text-slate-900">{t("wizard.unlockAiFeatures")}</span>
            <div className="w-16" />
          </div>
        </header>

        <main className="max-w-lg mx-auto px-4 py-10">
          {/* Alert */}
          <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-amber-800">{t("wizard.usageLimitReached")}</h3>
                <p className="text-sm text-amber-700 mt-1">
                  {limitReachedMessage || t("wizard.usageLimitDefault")}
                </p>
              </div>
            </div>
          </div>

          {/* Destination Preview */}
          {destination && (
            <div className="mb-6 p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm text-slate-500">{t("wizard.yourTripTo")}</p>
                  <p className="font-bold text-slate-900">{destination}</p>
                </div>
              </div>
            </div>
          )}

          {/* Beta Code Input */}
          <BetaCodeInput
            variant="default"
            showBenefits={true}
            onSuccess={async () => {
              // Refresh early access status
              await refreshEarlyAccess();
              // Hide prompt and retry generation
              setShowInlineLimitPrompt(false);
              setLimitReachedMessage(null);
              // Retry generation after short delay
              setTimeout(() => {
                setPendingGeneration(false);
                handleGenerate();
              }, 500);
            }}
            className="mb-6"
          />

          {/* Waitlist Option */}
          <div className="mb-8">
            <WaitlistSignup
              variant="default"
              source="trip_generation_limit"
            />
          </div>

          {/* Alternative Actions */}
          <div className="border-t border-slate-200 pt-6">
            <p className="text-sm text-slate-500 text-center mb-4">
              While you wait for beta access:
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/templates"
                className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-center font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Browse Templates
              </Link>
              <Link
                href="/trips"
                className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-center font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                View My Trips
              </Link>
            </div>
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

  // Decision-first arm — renders its own intake UI (prompt → proposals → pick →
  // confirm dates), then maps the picked proposal onto wizard state and calls
  // handleGenerate(). Sits AFTER the generatedItinerary (~1596) and generating
  // (~2360) early-returns: once the arm triggers a generate, those take over and
  // render the shared generating + result + save flow for free.
  if (arm === "decision") {
    return (
      <DecisionIntake
        locale={locale}
        onPick={(mapped) => {
          // Map the picked + date-confirmed proposal onto the SAME state
          // handleGenerate re-reads, then call it. handleGenerate rebuilds
          // TripCreationParams from this state and reuses streaming + JSON
          // fallback + generating/result/save_* + first_value telemetry (all
          // now arm-tagged "decision").
          setError(null);
          setDestination(mapped.destination);
          if (mapped.destinationCoords) setDestinationCoords(mapped.destinationCoords);
          setStartDate(mapped.startDate);
          setEndDate(mapped.endDate);
          setBudgetTier(mapped.budgetTier);
          setPace(mapped.pace);
          setSelectedVibes(mapped.vibes);
          if (mapped.travelStyle) setTravelStyle(mapped.travelStyle);
          if (mapped.requirements) setRequirements(mapped.requirements);
          // State setters are async; defer handleGenerate to the next macrotask
          // so it reads the just-committed state (else the destination/dates gate
          // reads pre-update "" values and 400s at validateTripParams).
          setTimeout(() => {
            void handleGenerate();
          }, 0);
        }}
      />
    );
  }

  // Wizard form
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <WizardReplay />
      {/* Auth Prompt Modal - for gradual engagement */}
      <AuthPromptModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        destination={destination}
      />

      {/* Early Access Modal - for gated AI features */}
      <EarlyAccessModal
        isOpen={showEarlyAccessModal}
        onClose={() => {
          setShowEarlyAccessModal(false);
          setPendingGeneration(false);
        }}
        onRedeemCode={async (code) => {
          const success = await redeemCode(code);
          if (success) {
            // Refresh status and retry generation
            await refreshEarlyAccess();
            if (pendingGeneration) {
              setPendingGeneration(false);
              // Small delay to ensure state is updated
              setTimeout(() => handleGenerate(), 100);
            }
          }
          return success;
        }}
        error={earlyAccessError}
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
        {isAuthenticated && hasExistingTrips && showReturningUserBanner && step === 1 && (
          <div className="mb-6 p-4 bg-gradient-to-r from-[var(--primary)]/5 to-[var(--secondary)]/5 border border-[var(--primary)]/20 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-[var(--primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
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
                    2026-05-31 launch-readiness UX: detect server-busy
                    error patterns (5xx from /api/ai/generate) and show a
                    user-friendly message instead of the raw "Failed to
                    generate valid itinerary after retries" / "AI service
                    unavailable" string. These error strings can leak
                    when the upstream Gemini API is rate-limited, the key
                    is revoked, or any other 5xx fires after the retry
                    budget is exhausted — none of which the user can act
                    on. The friendly message + retry button gives them a
                    concrete next step.
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

        {/* Step 1: Destination + Dates (combined for fewer drop-offs) */}
        {step === 1 && (
          <div className="space-y-6">
            {/* Returning-visitor draft recovery. A valid unsaved draft exists
                within the 24h window — mount the (previously built but never
                rendered) banner so the user recovers straight into the Save
                moment instead of re-running the wizard and burning another
                scarce anon generation. Funnel audit Rank 4a. */}
            {showDraftRecovery && draft && (
              <DraftRecoveryBanner
                draft={draft}
                onRestore={handleRestoreDraft}
                onDiscard={handleDiscardDraft}
              />
            )}
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1 sm:mb-2">
                {t("wizard.step1.title")}
              </h1>
              <p className="text-slate-600">
                {t("wizard.step1.subtitle")}
              </p>
            </div>

            {/* Backpacker Mode — shipped 2026-05-28.
                Strategic wedge for partner conversations (Hostelworld in
                particular — backpackers are their core demo). Toggle is
                deliberately compact / unobtrusive: classic users see one
                extra line, backpackers light up the whole AI plan.
                Auto-bumps budget to "budget" when activated; user can
                still override the budget tier in step 2. */}
            <div>
              <button
                type="button"
                onClick={() => {
                  const next = travelStyle === "backpacker" ? "classic" : "backpacker";
                  setTravelStyle(next);
                  // Auto-align budget with the preset, unless the user
                  // has already explicitly picked a different tier in
                  // this session. We keep this lightweight (no warning)
                  // because step 2 still lets them override.
                  if (next === "backpacker" && budgetTier !== "budget") {
                    setBudgetTier("budget");
                  }
                }}
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

            {/* Who's coming? — Phase-1 measurement toggle.
                See docs/COLLAB_AUDIT.md "Phase 1: validate the bet".
                NO functional change today — just captures whether the
                user is planning solo or with friends so we can decide
                whether to invest in a full group-first restructure.
                **2026-05-24 i18n fix:** labels now read from messages
                so /it and /es see localized copy. Previously all
                hardcoded English on every locale. */}
            <div>
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
                      // Per LIVE_AUDIT F4: previous selected-state used
                      // bg-[var(--primary)]/5 which was barely visible.
                      // Bumped to /10 fill + primary-colored text for
                      // clearer "this is picked" affordance.
                      className={`relative flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                        isSelected
                          ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                      aria-pressed={isSelected}
                    >
                      {/* Per LIVE_AUDIT F5: icon now adopts the selected
                          color (brand pink) or slate (unselected) — was
                          dark navy in both states (off-brand). */}
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
                  {/* Per LIVE_AUDIT P1: "coming soon" was misleading —
                      invite-after-generation already works today. Honest
                      framing of what happens next. */}
                  You&rsquo;ll be able to invite friends to vote after we
                  generate the trip.
                </p>
              )}
            </div>

            {/* "Start Anywhere" — Gemini-Vision-powered prefill from image/URL.
                Sits above the destination input so users see the shortcut
                before typing. Opt-in (collapsed by default). */}
            <StartAnywhereSection
              onExtracted={(fields, ctx) => {
                if (fields.destination) {
                  setDestination(fields.destination);
                  // **2026-05-24 live-test fix:** previously this just
                  // nulled `destinationCoords`, which meant the
                  // SeasonalContextCard never updated its weather data
                  // (it depends on coords). The user would see Kyoto's
                  // weather on a Lisbon trip if they pivoted via Start
                  // Anywhere. Now we kick off a Places lookup in the
                  // background to populate coords → triggers the weather
                  // refresh.
                  setDestinationCoords(null);
                  (async () => {
                    try {
                      const r = await fetch(
                        `/api/places?destination=${encodeURIComponent(fields.destination!)}`
                      );
                      if (!r.ok) return;
                      const j = await r.json();
                      const loc = j?.location;
                      if (
                        loc &&
                        typeof loc.latitude === "number" &&
                        typeof loc.longitude === "number"
                      ) {
                        setDestinationCoords({
                          latitude: loc.latitude,
                          longitude: loc.longitude,
                        });
                      }
                    } catch {
                      // Non-fatal — wizard still works without coords;
                      // user just won't get the destination-specific
                      // seasonal weather refresh.
                    }
                  })();
                  trackDestinationSelected({
                    destination: fields.destination,
                    // "manual" is the closest existing source label until the
                    // analytics enum is widened to include "start_anywhere".
                    source: "manual",
                  });
                }
                if (fields.vibes.length > 0) {
                  setSelectedVibes(fields.vibes);
                }
                if (fields.suggestedStartDate && fields.suggestedEndDate) {
                  setStartDate(fields.suggestedStartDate);
                  setEndDate(fields.suggestedEndDate);
                }
                // Tracking is emitted server-side by /api/ai/extract-trip-context
                // (logApiCall with destination_confidence + identified_destination
                // metadata). Skip client-side trackFieldInteraction since the
                // existing field-interaction enum doesn't include this source.
                setError(null);
                console.log("[StartAnywhere] extracted:", ctx);
              }}
            />

            {/* Multi-city toggle (wedge) — gated by NEXT_PUBLIC_MULTI_CITY_ENABLED */}
            {MULTI_CITY_ENABLED && (
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
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
                // A11y (task #193): wire visible "Destination" header to the
                // <input> so screen readers announce "Destination, edit" with
                // context instead of bare "edit". aria-required reflects that
                // this is a required wizard field.
                ariaLabelledBy="wizard-destination-label"
                ariaRequired
                // autoFocus removed (2026-05-03) — on mobile it auto-opened
                // the suggestions dropdown which covered the popular-
                // destination pills below. Users tapping a pill ended up
                // hitting "Santorini" / "Tokyo" instead. Without autoFocus,
                // the pills are visible by default; users can still tap
                // the input to reveal the autocomplete dropdown when they
                // want it.
              />

              {/* Popular destinations - compact pills */}
              {!destination && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { name: "Paris, France", flag: "🇫🇷", coords: { latitude: 48.8566, longitude: 2.3522 } },
                      { name: "Tokyo, Japan", flag: "🇯🇵", coords: { latitude: 35.6762, longitude: 139.6503 } },
                      { name: "Rome, Italy", flag: "🇮🇹", coords: { latitude: 41.9028, longitude: 12.4964 } },
                      { name: "Barcelona, Spain", flag: "🇪🇸", coords: { latitude: 41.3851, longitude: 2.1734 } },
                      { name: "New York, USA", flag: "🇺🇸", coords: { latitude: 40.7128, longitude: -74.0060 } },
                      { name: "Sydney, Australia", flag: "🇦🇺", coords: { latitude: -33.8688, longitude: 151.2093 } },
                    ].map((place) => (
                      <button
                        key={place.name}
                        onClick={() => {
                          trackFieldInteraction("destination_pill");
                          setDestination(place.name);
                          setDestinationCoords(place.coords);
                          trackDestinationSelected({
                            destination: place.name,
                            source: "popular",
                          });
                        }}
                        className="px-3 py-2 sm:px-4 sm:py-2 rounded-full border border-slate-200 text-sm text-slate-700
                                   hover:border-[var(--primary)] hover:text-[var(--primary)]
                                   active:bg-[var(--primary)]/10
                                   hover:bg-[var(--primary)]/5 transition-all duration-200
                                   flex items-center gap-1.5 min-h-[40px]"
                      >
                        <span>{place.flag}</span>
                        <span>{place.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

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
                    onChange={(e) => {
                      trackFieldInteraction("start_date");
                      setStartDate(e.target.value);
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
                  onStartDateChange={(d) => {
                    trackFieldInteraction("start_date");
                    setStartDate(d);
                  }}
                  onEndDateChange={(d) => {
                    trackFieldInteraction("end_date");
                    setEndDate(d);
                  }}
                  maxDays={14}
                  minDate={new Date().toISOString().split("T")[0]}
                  // A11y (task #193): dates required to advance the wizard.
                  ariaRequired
                />
              )}
            </div>

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
                    <span className="text-xs text-slate-400 font-normal">(defaults: Balanced budget, Moderate pace)</span>
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
                      {t("requirements.title")} <span className="font-normal text-slate-400">({t("requirements.hint").split(" - ")[0]})</span>
                    </label>
                    <textarea
                      value={requirements}
                      onChange={(e) => setRequirements(e.target.value)}
                      placeholder={t("requirements.placeholder")}
                      rows={2}
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors resize-none text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation — sticky on mobile so users always see the CTA */}
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 px-4 py-3 sm:relative sm:bg-transparent sm:border-t-slate-200 sm:px-0 sm:py-0 sm:mt-8 sm:pt-6 sm:z-auto">
          {/* Missing-field hint — directly attacks the step-1 cliff: the
              Continue button is disabled with no visible reason, so users
              who don't realize what unlocks it just leave. Name the first
              blocker so the path forward is always obvious. */}
          {step === 1 && !canProceed() && (
            <p className="mb-2 text-center text-xs font-medium text-slate-500 sm:text-left">
              {destination.length < 2
                ? t("wizard.step1.hintNeedDestination")
                : t("wizard.step1.hintNeedDates")}
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
            <button
              onClick={() => {
                captureTripWizardStepCompleted({
                  step_number: step,
                  step_name: STEP_NAMES_CONST[step - 1],
                });
                // Per LIVE_AUDIT F2: pre-apply seasonal vibe suggestions
                // when advancing into step 2. Previously the suggestions
                // were shown on step 1 ("SUGGESTED VIBES: Adventure")
                // but the user had to manually pick them on step 2 —
                // an obvious lost flow. Only seeds if the user hasn't
                // already picked vibes (don't clobber their choices)
                // AND only when there's no Saved draft to restore.
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
                    // starts empty (existing behaviour).
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
          ) : (
            <button
              onClick={handleGenerate}
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
        MobileBottomNav was previously rendered here but it sits at fixed
        bottom-0 / z-50 on mobile, which completely covered the wizard's
        own sticky Continue/Generate button (z-40). Step 1 → step 2 was
        unreachable on mobile.

        The wizard is a focused flow: the user is already on /trips/new
        (so the "New" tab in MobileBottomNav points to themselves), and
        the global Navbar at the top provides the navigation paths. The
        result view doesn't render MobileBottomNav either — same pattern.
      */}
    </div>
  );
}
