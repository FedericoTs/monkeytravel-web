import type { RouteStop } from "@/components/trips/MultiCityRouteBuilder";
import type { Diet } from "@/lib/trips/diet";
import type { SeasonalContext, TripCreationParams } from "@/types";
import type { WizardAnswers } from "./answers";
import { isChosenTripIntent } from "./answers";

/** A route's filled rows (a city and at least one night), as the legs the server plans one by one. */
export function routeLegs(rows: RouteStop[]): RouteStop[] {
  return rows.filter((r) => r.city.trim() && r.nights > 0).map((r) => ({ city: r.city.trim(), nights: r.nights }));
}

export interface GenerationRequest {
  body: TripCreationParams & { locale: string; dietary?: Diet[]; fresh?: true; destinationCoords?: { latitude: number; longitude: number } };
  /** Multi-city and anchored trips come back as one merged JSON body, not a stream. */
  stream: boolean;
  /** More than one leg: /api/ai/generate fans the trip out per city. */
  isMultiCity: boolean;
  isAnchored: boolean;
}

/**
 * What a Generate sends. A route of more than one leg is planned per city and
 * leaves the anchors out: the anchor panel is hidden in multi-city mode, so
 * any left in state are stale. Must-dos, anchors and diets go only when there
 * are some (each makes the plan personal, which skips the shared cache
 * server-side), and a regenerate asks for a fresh plan. The page locale picks
 * the itinerary's language.
 */
export function generationRequest(
  answers: WizardAnswers,
  extra: {
    legs: RouteStop[];
    interests: string[];
    seasonalContext: SeasonalContext | null;
    requirements: string;
    locale: string;
    fresh?: boolean;
    /** Where the destination is, when it was picked from a list; the server works out its sunrise and sunset. */
    coordinates?: { latitude: number; longitude: number } | null;
  }
): GenerationRequest {
  const { destination, startDate, endDate, budgetTier, pace, vibes, mustDos, travelStyle, tripIntent, anchors, dietary } = answers;
  const isMultiCity = extra.legs.length > 1;
  const isAnchored = !isMultiCity && anchors.length > 0;
  const params: TripCreationParams = {
    destination,
    startDate,
    endDate,
    budgetTier,
    pace,
    vibes,
    seasonalContext: extra.seasonalContext || undefined,
    interests: extra.interests,
    requirements: extra.requirements || undefined,
    ...(mustDos.length > 0 ? { mustDos } : {}),
    travelStyle,
    ...(isChosenTripIntent(tripIntent) ? { tripIntent } : {}),
    ...(isMultiCity ? { destinations: extra.legs } : {}),
    ...(isAnchored ? { anchors } : {}),
  };
  return {
    body: {
      ...params,
      locale: extra.locale,
      ...(dietary.length > 0 ? { dietary } : {}),
      ...(extra.fresh ? { fresh: true as const } : {}),
      ...(!isMultiCity && extra.coordinates
        ? { destinationCoords: { latitude: extra.coordinates.latitude, longitude: extra.coordinates.longitude } }
        : {}),
    },
    stream: !isMultiCity && !isAnchored,
    isMultiCity,
    isAnchored,
  };
}
