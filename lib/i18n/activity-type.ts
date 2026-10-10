import { useTranslations } from "next-intl";

/** The keys under trips.activityTypes in messages/{en,es,it,pt}/trips.json. */
export const ACTIVITY_TYPE_KEYS = [
  "restaurant",
  "attraction",
  "activity",
  "nature",
  "shopping",
  "entertainment",
  "transport",
  "cultural",
  "museum",
  "landmark",
  "food",
  "cafe",
  "bar",
  "foodie",
  "wineBar",
  "park",
  "market",
  "nightlife",
  "spa",
  "wellness",
  "event",
  "adventure",
  "urban",
  "sightseeing",
  "accommodation",
  "romantic",
  "tour",
  "beach",
] as const;

export type ActivityTypeKey = (typeof ACTIVITY_TYPE_KEYS)[number];

// Other words the generator writes for a category that has a key, a few of them in
// the trip's language. Each matches a whole part of a type or one word of it.
const SYNONYMS: Record<string, ActivityTypeKey> = {
  dining: "restaurant",
  meal: "restaurant",
  ristorante: "restaurant",
  restaurante: "restaurant",
  comida: "food",
  cibo: "food",
  culinary: "foodie",
  gastronomy: "foodie",
  gastronomia: "foodie",
  gastronomía: "foodie",
  food_experience: "foodie",
  food_tour: "foodie",
  cooking_class: "foodie",
  food_market: "market",
  mercato: "market",
  mercado: "market",
  bakery: "cafe",
  café: "cafe",
  pub: "bar",
  wine_bar: "wineBar",
  viewpoint: "attraction",
  attrazione: "attraction",
  atracción: "attraction",
  atração: "attraction",
  scenic: "sightseeing",
  exploration: "sightseeing",
  explore: "sightseeing",
  historic: "landmark",
  historical: "landmark",
  heritage: "landmark",
  monument: "landmark",
  memorial: "landmark",
  architecture: "landmark",
  religious: "landmark",
  temple: "landmark",
  church: "landmark",
  castle: "landmark",
  palace: "landmark",
  unesco: "landmark",
  culture: "cultural",
  art: "cultural",
  history: "cultural",
  gallery: "museum",
  art_gallery: "museum",
  art_museum: "museum",
  museo: "museum",
  museu: "museum",
  city: "urban",
  town: "urban",
  neighborhood: "urban",
  neighbourhood: "urban",
  district: "urban",
  excursion: "tour",
  excursión: "tour",
  escursione: "tour",
  day_trip: "tour",
  cruise: "tour",
  natural: "nature",
  natura: "nature",
  naturaleza: "nature",
  natureza: "nature",
  outdoor: "nature",
  outdoors: "nature",
  hiking: "nature",
  hike: "nature",
  trekking: "nature",
  wildlife: "nature",
  mountain: "nature",
  garden: "park",
  spiaggia: "beach",
  playa: "beach",
  playas: "beach",
  praia: "beach",
  aventura: "adventure",
  avventura: "adventure",
  theme: "entertainment",
  amusement: "entertainment",
  water_park: "entertainment",
  show: "entertainment",
  performance: "entertainment",
  theater: "entertainment",
  theatre: "entertainment",
  music: "entertainment",
  concert: "event",
  festival: "event",
  transportation: "transport",
  travel: "transport",
  transfer: "transport",
  departure: "transport",
  arrival: "transport",
  trasporto: "transport",
  transporte: "transport",
  lodging: "accommodation",
  hotel: "accommodation",
  hostel: "accommodation",
  resort: "accommodation",
  attività: "activity",
  actividad: "activity",
  atividade: "activity",
};

const LOOKUP = new Map<string, ActivityTypeKey>([
  ...ACTIVITY_TYPE_KEYS.map((key) => [key.toLowerCase(), key] as const),
  ...Object.entries(SYNONYMS),
]);

/**
 * The message key for a model-written activity type, or null when nothing in it
 * is recognisable. The generator strays from the keys ("food_market", "Cultural
 * attraction", "restaurant/viewpoint"), so the first part (split on / , | &) that
 * names a category wins, as a whole or by its first known word.
 */
export function activityTypeKey(type: string | null | undefined): ActivityTypeKey | null {
  if (typeof type !== "string") return null;
  for (const part of type.toLowerCase().split(/[/,|&]/)) {
    const joined = part.trim().replace(/[\s-]+/g, "_");
    const hit = LOOKUP.get(joined) ?? joined.split(/[^\p{L}]+/u).map((word) => LOOKUP.get(word)).find(Boolean);
    if (hit) return hit;
  }
  return null;
}

/**
 * Labels an activity's `type` in the visitor's language. A type with no
 * recognisable category reads as a plain "Activity", never as the raw word.
 */
export function useActivityTypeLabel(): (type: string | undefined) => string {
  const t = useTranslations("trips.activityTypes");
  return (type) => (type ? t(activityTypeKey(type) ?? "activity") : "");
}
