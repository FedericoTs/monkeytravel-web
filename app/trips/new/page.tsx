"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import type { GeneratedItinerary, TripCreationParams, TripVibe, SeasonalContext } from "@/types";
import DestinationHero from "@/components/DestinationHero";
import ActivityCard from "@/components/ActivityCard";
import VibeSelector from "@/components/trip/VibeSelector";
import SeasonalContextCard from "@/components/trip/SeasonalContextCard";
import GenerationProgress from "@/components/trip/GenerationProgress";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import DestinationAutocomplete, { PlacePrediction } from "@/components/ui/DestinationAutocomplete";
import DateRangePicker from "@/components/ui/DateRangePicker";
import { buildSeasonalContext } from "@/lib/seasonal";
// New UX enhancement components
import StartOverModal from "@/components/trip/StartOverModal";
import RegenerateButton from "@/components/trip/RegenerateButton";
import ValuePropositionBanner from "@/components/trip/ValuePropositionBanner";
import AuthPromptModal from "@/components/ui/AuthPromptModal";
import EarlyAccessModal from "@/components/ui/EarlyAccessModal";
import OnboardingModal from "@/components/ui/OnboardingModal";
import { BetaCodeInput, WaitlistSignup } from "@/components/beta";
import { hasLocalOnboardingPreferences } from "@/hooks/useOnboardingPreferences";
import { useEarlyAccess } from "@/lib/hooks/useEarlyAccess";
import { useItineraryDraft, DraftRecoveryBanner } from "@/hooks/useItineraryDraft";
import { useCurrency } from "@/lib/locale";

// Dynamic import for TripMap to avoid SSR issues
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[350px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-400">Loading map...</span>
    </div>
  ),
});

// Vibe to interests mapping - automatically derives interests from selected vibes
// This ensures the AI receives relevant interest signals based on vibe selection
const VIBE_TO_INTERESTS: Record<string, string[]> = {
  adventure: ["adventure", "nature", "photography"],
  cultural: ["culture", "history", "art"],
  foodie: ["food"],
  wellness: ["relaxation"],
  romantic: ["relaxation", "photography"],
  urban: ["nightlife", "shopping", "art"],
  nature: ["nature", "photography", "adventure"],
  offbeat: ["adventure", "culture"],
  // Fantasy vibes
  "time-traveler": ["history", "culture", "art"],
  "photo-hunter": ["photography", "nature", "art"],
  "local-life": ["food", "culture"],
  "night-owl": ["nightlife", "food"],
};

const BUDGET_TIERS = [
  {
    id: "budget" as const,
    label: "Budget",
    description: "Free attractions, street food, public transport",
    range: "< $100/day",
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-500",
  },
  {
    id: "balanced" as const,
    label: "Balanced",
    description: "Mix of experiences, local restaurants, some tours",
    range: "$100-250/day",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-500",
  },
  {
    id: "premium" as const,
    label: "Premium",
    description: "Skip-the-line, fine dining, private tours",
    range: "$250+/day",
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-500",
  },
];

const PACE_OPTIONS = [
  { id: "relaxed" as const, label: "Relaxed", description: "2-3 activities/day" },
  { id: "moderate" as const, label: "Moderate", description: "3-4 activities/day" },
  { id: "active" as const, label: "Active", description: "5+ activities/day" },
];

export default function NewTripPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedItinerary, setGeneratedItinerary] = useState<GeneratedItinerary | null>(null);

  // Auth state for gradual engagement
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

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
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budgetTier, setBudgetTier] = useState<"budget" | "balanced" | "premium">("balanced");
  const [pace, setPace] = useState<"relaxed" | "moderate" | "active">("moderate");
  const [selectedVibes, setSelectedVibes] = useState<TripVibe[]>([]);
  const [requirements, setRequirements] = useState("");
  const [seasonalContext, setSeasonalContext] = useState<SeasonalContext | null>(null);

  // UX enhancement state
  const [showStartOverModal, setShowStartOverModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showDraftRecovery, setShowDraftRecovery] = useState(false);
  const [draftAutoRestored, setDraftAutoRestored] = useState(false);

  // LocalStorage draft persistence
  const { draft, saveDraft, clearDraft, hasDraft } = useItineraryDraft();

  // Currency conversion hook - converts prices to user's preferred currency
  const { convert: convertCurrency } = useCurrency();

  const TOTAL_STEPS = 4; // Added vibe step

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);
    };
    checkAuth();
  }, []);

  // Handle pending generation after signup (when draft is restored)
  useEffect(() => {
    // Only run if authenticated AND draft has been auto-restored
    if (isAuthenticated && draftAutoRestored && localStorage.getItem("pendingTripGeneration") === "true") {
      // Check if we have the required form state (from draft restoration)
      if (destination && startDate && endDate && selectedVibes.length > 0 && !generating && !generatedItinerary) {
        localStorage.removeItem("pendingTripGeneration");
        // Small delay to ensure UI is ready and React state has propagated
        const timer = setTimeout(() => {
          handleGenerate();
        }, 500);
        return () => clearTimeout(timer);
      }
    }
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

  // Build seasonal context when destination and dates are set
  // Uses latitude for accurate hemisphere detection (fixes Southern Hemisphere bug)
  useEffect(() => {
    if (destination && startDate) {
      const context = buildSeasonalContext(
        destination,
        startDate,
        destinationCoords?.latitude // Pass latitude for correct hemisphere
      );
      setSeasonalContext(context);
    } else {
      setSeasonalContext(null);
    }
  }, [destination, startDate, destinationCoords]);

  // Check for unsaved draft on mount - AUTO-RESTORE if coming back from auth
  useEffect(() => {
    if (hasDraft && draft && !generatedItinerary && !draftAutoRestored) {
      // Check if we're coming back from auth with pending generation
      const hasPendingGeneration = localStorage.getItem("pendingTripGeneration") === "true";

      if (hasPendingGeneration) {
        // Auto-restore the draft silently (no banner) for seamless post-auth experience
        // The draft contains form state (destination, dates, vibes, budget) but NOT generated itinerary
        setDestination(draft.destination);
        setStartDate(draft.startDate);
        setEndDate(draft.endDate);
        setPace(draft.pace as "relaxed" | "moderate" | "active");
        setSelectedVibes(draft.vibes as TripVibe[]);
        setBudgetTier(draft.budgetTier as "budget" | "balanced" | "premium");
        // Note: draft.generatedItinerary is null when saved before auth
        // Don't restore coordinates - they'll be re-fetched if needed
        setDraftAutoRestored(true);
        // Don't show the banner since we're auto-restoring
      } else {
        // Normal draft recovery - show banner to let user choose
        setShowDraftRecovery(true);
      }
    }
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
      });
    }
  }, [generatedItinerary, destination, startDate, endDate, pace, selectedVibes, budgetTier, saveDraft]);

  // Handle draft restoration
  const handleRestoreDraft = () => {
    if (draft) {
      setDestination(draft.destination);
      setStartDate(draft.startDate);
      setEndDate(draft.endDate);
      setPace(draft.pace as "relaxed" | "moderate" | "active");
      setSelectedVibes(draft.vibes as TripVibe[]);
      setBudgetTier(draft.budgetTier as "budget" | "balanced" | "premium");
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
    setGeneratedItinerary(null); // Clear current to show progress

    // Small delay for visual feedback
    await new Promise(resolve => setTimeout(resolve, 100));

    // Re-trigger generation
    await handleGenerate();
    setIsRegenerating(false);
  };

  // Handle start over - confirmed discard
  const handleStartOver = () => {
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

  // Derive interests from selected vibes for AI prompt compatibility
  const deriveInterestsFromVibes = (): string[] => {
    const interestSet = new Set<string>();
    selectedVibes.forEach((vibe) => {
      // TripVibe is a string type, use directly as key
      const interests = VIBE_TO_INTERESTS[vibe] || [];
      interests.forEach((interest) => interestSet.add(interest));
    });
    return Array.from(interestSet);
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return destination.length >= 2;
      case 2:
        return startDate && endDate && new Date(endDate) >= new Date(startDate);
      case 3:
        return selectedVibes.length > 0; // At least one vibe required
      case 4:
        return true; // Budget and pace have defaults, requirements is optional
      default:
        return false;
    }
  };

  // Handle destination selection from autocomplete
  const handleDestinationSelect = (prediction: PlacePrediction) => {
    if (prediction.coordinates) {
      setDestinationCoords(prediction.coordinates);
    }
  };

  const handleGenerate = async () => {
    // Check authentication first - show modal if not logged in
    if (!isAuthenticated) {
      // Save current form state to draft before prompting
      if (destination && startDate && endDate) {
        saveDraft({
          generatedItinerary: null as unknown as GeneratedItinerary,
          destination,
          startDate,
          endDate,
          pace,
          vibes: selectedVibes,
          budgetTier,
        });
      }

      // Check if onboarding has been completed
      // If not, show onboarding modal first → then auth modal
      const hasOnboardingPrefs = hasLocalOnboardingPreferences();
      if (!hasOnboardingPrefs) {
        setShowOnboardingModal(true);
        return;
      }

      // Onboarding done, show auth modal
      setShowAuthModal(true);
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      // Derive interests from vibes for API compatibility
      const derivedInterests = deriveInterestsFromVibes();

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
      };

      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok) {
        // Check for early access gate
        if (data.code === "NO_ACCESS" || data.code === "LIMIT_REACHED") {
          setPendingGeneration(true);
          // Show inline prompt instead of modal for better UX
          setShowInlineLimitPrompt(true);
          setLimitReachedMessage(data.error || "You've reached your usage limit");
          setGenerating(false);
          return;
        }
        throw new Error(data.error || "Generation failed");
      }

      // Fetch activity images in parallel (using FREE Pexels API)
      const itinerary = data.itinerary;
      try {
        // Collect all activities
        const allActivities = itinerary.days.flatMap((day: { activities: { name: string; type: string }[] }) =>
          day.activities.map((a: { name: string; type: string }) => ({ name: a.name, type: a.type }))
        );

        // Batch fetch images
        const imageResponse = await fetch("/api/images/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activities: allActivities,
            destination: itinerary.destination.name,
          }),
        });

        if (imageResponse.ok) {
          const { images } = await imageResponse.json();

          // Inject image_url into each activity
          for (const day of itinerary.days) {
            for (const activity of day.activities) {
              if (images[activity.name]) {
                activity.image_url = images[activity.name];
              }
            }
          }
        }
      } catch (imageError) {
        console.error("Failed to fetch activity images:", imageError);
        // Continue without images - not critical
      }

      setGeneratedItinerary(itinerary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveTrip = async () => {
    if (!generatedItinerary) return;

    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Not authenticated");

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

      const { data: trip, error: tripError } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          title: `${generatedItinerary.destination.name} Trip`,
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

      // Clear draft on successful save
      clearDraft();
      router.push(`/trips/${trip.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trip");
    } finally {
      setLoading(false);
    }
  };

  // Show generated itinerary
  if (generatedItinerary) {
    const fullDestination = `${generatedItinerary.destination.name}, ${generatedItinerary.destination.country}`;

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
        />

        {/* Hero with Cover Image */}
        <DestinationHero
          destination={fullDestination}
          title={fullDestination}
          subtitle={generatedItinerary.destination.description}
          dateRange={`${startDate} to ${endDate}`}
          budget={{
            total: generatedItinerary.trip_summary.total_estimated_cost,
            currency: generatedItinerary.trip_summary.currency,
          }}
          days={generatedItinerary.days.length}
          tags={generatedItinerary.destination.best_for}
          showBackButton={false}
        />

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
              Start Over
            </button>

            {/* Trip Summary */}
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="px-2 py-1 bg-slate-100 rounded-lg">
                {generatedItinerary.days.length} days
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
              <RegenerateButton
                onRegenerate={handleRegenerate}
                isRegenerating={isRegenerating || generating}
                variant="compact"
              />
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
                    Saving...
                  </>
                ) : (
                  <>
                    Save Trip
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </>
                )}
              </button>
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
                  Saving...
                </>
              ) : (
                <>
                  Save Trip
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Interactive Map */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Trip Overview</h2>
              <span className="text-sm text-slate-500">{generatedItinerary.destination.weather_note}</span>
            </div>
            <TripMap
              days={generatedItinerary.days}
              destination={fullDestination}
              className="h-[350px]"
            />
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">Duration</div>
              <div className="font-semibold text-xl text-slate-900">{generatedItinerary.days.length} days</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">Est. Budget</div>
              <div className="font-semibold text-xl text-slate-900">
                {convertCurrency(
                  generatedItinerary.trip_summary.total_estimated_cost,
                  generatedItinerary.trip_summary.currency
                ).formatted}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">Activities</div>
              <div className="font-semibold text-xl text-slate-900">
                {generatedItinerary.days.reduce((acc, day) => acc + day.activities.length, 0)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">Pace</div>
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
                Book Your Travel
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <div className="text-sm font-medium text-amber-800 mb-3">Flights</div>
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
                  <div className="text-sm font-medium text-amber-800 mb-3">Hotels</div>
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
              <div key={day.day_number}>
                {/* Day Header */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 text-white flex items-center justify-center font-bold text-lg shadow-lg">
                      {day.day_number}
                    </div>
                    <div>
                      <h2 className="font-bold text-xl text-slate-900">Day {day.day_number}</h2>
                      {day.theme && <p className="text-slate-500 text-sm">{day.theme}</p>}
                    </div>
                  </div>
                  {day.daily_budget && (
                    <div className="ml-auto text-right">
                      <div className="text-sm text-slate-500">Est. Budget</div>
                      <div className="font-semibold text-slate-900">
                        {convertCurrency(
                          day.daily_budget.total,
                          generatedItinerary.trip_summary.currency
                        ).formatted}
                      </div>
                    </div>
                  )}
                </div>

                {/* Activities as Cards */}
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
                Packing Suggestions
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
                <h4 className="font-semibold text-amber-900 mb-1">AI-Generated Itinerary with Verified Data</h4>
                <p className="text-sm text-amber-800">
                  This itinerary was created by AI and enriched with real-time data from Google Places.
                  Click "More" on any activity to see verified photos, ratings, and price levels.
                  We recommend double-checking opening hours before your trip.
                </p>
              </div>
            </div>
          </div>

          {/* Simple Regenerate CTA for users who scrolled to the bottom */}
          <div className="mt-8 flex flex-col items-center gap-4 pb-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Not quite right?
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
              <span className="hidden sm:inline">Back</span>
            </button>
            <span className="font-semibold text-slate-900">Unlock AI Features</span>
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
                <h3 className="font-semibold text-amber-800">Usage Limit Reached</h3>
                <p className="text-sm text-amber-700 mt-1">
                  {limitReachedMessage || "You've used your free AI generations."}
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
                  <p className="text-sm text-slate-500">Your trip to</p>
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
      />
    );
  }

  // Wizard form
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Onboarding Modal - collect preferences before signup */}
      <OnboardingModal
        isOpen={showOnboardingModal}
        onClose={() => setShowOnboardingModal(false)}
        destination={destination}
        onComplete={() => {
          // Onboarding complete, now show auth modal
          setShowOnboardingModal(false);
          setShowAuthModal(true);
        }}
      />

      {/* Auth Prompt Modal - for gradual engagement (after onboarding) */}
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
            <span className="hidden sm:inline">Back</span>
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

      {/* Form Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Step 1: Destination */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                Where do you want to go?
              </h1>
              <p className="text-slate-600">
                Search for a city to start planning your trip
              </p>
            </div>

            <DestinationAutocomplete
              value={destination}
              onChange={setDestination}
              onSelect={handleDestinationSelect}
              placeholder="e.g., Paris, Tokyo, New York..."
              autoFocus
            />

            {/* Popular destinations - with coordinates for accurate weather */}
            <div>
              <div className="text-sm text-slate-500 mb-3">Popular destinations</div>
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
                      setDestination(place.name);
                      setDestinationCoords(place.coords);
                    }}
                    className="px-4 py-2 rounded-full border border-slate-200 text-slate-700
                               hover:border-[var(--primary)] hover:text-[var(--primary)]
                               hover:bg-[var(--primary)]/5 transition-all duration-200
                               flex items-center gap-2"
                  >
                    <span>{place.flag}</span>
                    <span>{place.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Dates */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                When are you traveling?
              </h1>
              <p className="text-slate-600">Select your trip dates (max 14 days)</p>
            </div>

            {/* Premium Date Range Picker */}
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              maxDays={14}
              minDate={new Date().toISOString().split("T")[0]}
            />

            {/* Seasonal Context Card - Auto-displays when dates are set */}
            {destination && startDate && endDate && (
              <SeasonalContextCard
                destination={destination}
                startDate={startDate}
                endDate={endDate}
                coordinates={destinationCoords || undefined}
                className="mt-6"
              />
            )}
          </div>
        )}

        {/* Step 3: Vibe Selection (NEW) */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                What's your travel vibe?
              </h1>
              <p className="text-slate-600">
                Choose the mood that captures your ideal {destination} experience
              </p>
            </div>

            <VibeSelector
              selectedVibes={selectedVibes}
              onVibesChange={setSelectedVibes}
              maxVibes={3}
            />
          </div>
        )}

        {/* Step 4: Preferences */}
        {step === 4 && (
          <div className="space-y-8">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                Final details
              </h1>
              <p className="text-slate-600">
                Set your budget, pace, and any special requirements
              </p>
            </div>

            {/* Budget */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-3">Budget preference</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {BUDGET_TIERS.map((tier) => (
                  <button
                    key={tier.id}
                    onClick={() => setBudgetTier(tier.id)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      budgetTier === tier.id
                        ? `${tier.borderColor} ${tier.bgColor}`
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between sm:block">
                      <div>
                        <div className={`font-semibold ${tier.color}`}>{tier.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">{tier.description}</div>
                      </div>
                      <div className="text-sm text-slate-600 sm:hidden">{tier.range}</div>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 hidden sm:block">{tier.range}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Pace */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-3">Travel pace</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PACE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setPace(option.id)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      pace === option.id
                        ? "border-[var(--primary)] bg-[var(--primary)]/5"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between sm:block">
                      <div className="font-semibold text-slate-900">{option.label}</div>
                      <div className="text-xs text-slate-500 sm:mt-1">{option.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Special Requirements */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Special requirements (optional)
              </label>
              <textarea
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="e.g., wheelchair accessible, kid-friendly, vegetarian restaurants..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors resize-none"
              />
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-2 px-4 py-2.5 text-slate-600 hover:text-slate-900 font-medium rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">Back</span>
            </button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="bg-[var(--primary)] text-white px-8 py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!canProceed()}
              className="bg-[var(--accent)] text-slate-900 px-8 py-3 rounded-xl font-medium hover:bg-[var(--accent)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Itinerary
            </button>
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activePage="new" />
    </div>
  );
}
