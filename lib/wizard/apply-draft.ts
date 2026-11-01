import type { ItineraryDraft } from "@/hooks/useItineraryDraft";
import type { SessionTripData } from "@/hooks/useSessionTripStack";
import { dietsFrom, type Diet } from "@/lib/trips/diet";
import type { GeneratedItinerary, TripAnchor, TripVibe } from "@/types";

/** Where a restored draft goes: the wizard's fields, and the session tray. */
export interface DraftTargets {
  setDestination: (value: string) => void;
  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  setPace: (value: "relaxed" | "moderate" | "active") => void;
  setSelectedVibes: (value: TripVibe[]) => void;
  setBudgetTier: (value: "budget" | "balanced" | "premium") => void;
  setMustDos: (value: string[]) => void;
  setDietary: (value: Diet[]) => void;
  setTravelStyle: (value: "classic" | "backpacker") => void;
  setAnchors: (value: TripAnchor[]) => void;
  setTripIntent: (value: "solo" | "group") => void;
  setFlexibleDates: (value: boolean) => void;
  setGeneratedItinerary: (value: GeneratedItinerary) => void;
  /** Makes the restored trip the tray's current one, adopting a matching entry. */
  registerRestore: (trip: SessionTripData) => void;
}

/**
 * Put a stored draft back into the wizard. The silent restore after sign-in
 * and the banner's Restore both use it, so neither can drop a field the other
 * keeps. A field an older draft lacks keeps the wizard's default. Coordinates
 * are not stored: they are fetched again when needed.
 */
export function applyDraft(draft: ItineraryDraft, to: DraftTargets): void {
  to.setDestination(draft.destination);
  to.setStartDate(draft.startDate);
  to.setEndDate(draft.endDate);
  to.setPace(draft.pace as "relaxed" | "moderate" | "active");
  to.setSelectedVibes(draft.vibes as TripVibe[]);
  to.setBudgetTier(draft.budgetTier as "budget" | "balanced" | "premium");
  if (Array.isArray(draft.mustDos)) to.setMustDos(draft.mustDos);
  to.setDietary(dietsFrom(draft.dietary));
  if (draft.travelStyle === "backpacker") to.setTravelStyle("backpacker");
  if (draft.anchors && draft.anchors.length > 0) to.setAnchors(draft.anchors);
  if (draft.tripIntent === "solo" || draft.tripIntent === "group") to.setTripIntent(draft.tripIntent);
  if (draft.flexibleDates) to.setFlexibleDates(true);
  if (draft.generatedItinerary) {
    to.setGeneratedItinerary(draft.generatedItinerary);
    to.registerRestore({
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
}
