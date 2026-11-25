/**
 * When a dinner can start where a day ends. Restaurants in Spain open for dinner around 20:00 to 20:30, and in
 * Italy, France, Portugal and Greece around 19:00 to 19:30, so a dinner planned for 18:30 there finds the kitchen
 * shut; elsewhere 18:30 is a dinner hour. Read from the time zone of the place's pin (tz-lookup, server only). A
 * family with young children eats early wherever it is (lib/ai/trip-prompt.ts asks for dinner by 18:30 or 19:00):
 * it gets the usual hours, and a place open then.
 */
import tzlookup from "tz-lookup";
import type { TripCreationParams } from "@/types";

/** Minutes into the day: the earliest a dinner starts, and the latest. */
export interface DinnerHours {
  from: number;
  by: number;
}

const USUAL: DinnerHours = { from: 18 * 60 + 30, by: 21 * 60 };
const SPAIN: DinnerHours = { from: 20 * 60 + 30, by: 22 * 60 };
const LATER: DinnerHours = { from: 19 * 60 + 30, by: 21 * 60 };
const BY_ZONE: Record<string, DinnerHours> = {
  "Europe/Madrid": SPAIN,
  "Atlantic/Canary": SPAIN,
  "Africa/Ceuta": SPAIN,
  "Europe/Rome": LATER,
  "Europe/Vatican": LATER,
  "Europe/San_Marino": LATER,
  "Europe/Paris": LATER,
  "Europe/Monaco": LATER,
  "Europe/Lisbon": LATER,
  "Atlantic/Madeira": LATER,
  "Atlantic/Azores": LATER,
  "Europe/Athens": LATER,
};

/** The dinner hours where this pin is: the usual ones with no pin, for a family that eats early, or anywhere else. */
export function dinnerHours(at: { lat: number; lng: number } | null | undefined, early = false): DinnerHours {
  if (early || !at) return USUAL;
  try {
    return BY_ZONE[tzlookup(at.lat, at.lng)] ?? USUAL;
  } catch {
    return USUAL;
  }
}

/** A family with a child under seven, or one that gave no ages: its dinners are early. */
export function eatsEarly(params: Pick<TripCreationParams, "tripIntent" | "childrenAges">): boolean {
  if (params.tripIntent !== "family") return false;
  const ages = params.childrenAges ?? [];
  return ages.length === 0 || ages.some((band) => band === "under3" || band === "3to6");
}
