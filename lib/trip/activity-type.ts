/**
 * What an activity is. Meal hints, icons, prices, start times and covers all
 * branch on an activity's type, and the model writes it loosely: a vibe
 * ("foodie", "cultural"), a synonym, or a word in the trip's language.
 */

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
 * The types the planner asks for and the app reads. Every generation prompt
 * lists them, and normalizeActivityType maps anything else onto them.
 */
export const ACTIVITY_TYPES = [
  "restaurant",
  "cafe",
  "bar",
  "food",
  "market",
  "museum",
  "landmark",
  "attraction",
  "park",
  "nature",
  "beach",
  "shopping",
  "nightlife",
  "entertainment",
  "tour",
  "activity",
  "spa",
  "transport",
  "accommodation",
  "event",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const ON_THE_LIST = new Set<string>(ACTIVITY_TYPES);

// What a vague word becomes when the activity's name says nothing more.
const VAGUE: Partial<Record<ActivityTypeKey, ActivityType>> = {
  foodie: "food",
  wineBar: "bar",
  cultural: "attraction",
  urban: "attraction",
  sightseeing: "attraction",
  romantic: "attraction",
  adventure: "activity",
  wellness: "spa",
};

// When the word is vague, the name decides. First match wins, so a dinner show
// is a meal and a day trip with a museum stop is a tour.
const FROM_NAME: Array<[RegExp, ActivityType]> = [
  [/\b(street food|picnic|food (stalls?|courts?|trucks?|halls?)|hawker)\b/, "food"],
  [
    /\b(breakfast|brunch|lunch|dinner|supper|meal|restaurants?|ristorante|restaurante|trattoria|osteria|taverna|tavern|pizzeria|bistro|brasserie|izakaya|steakhouse|pranzo|cena|colazione|almuerzo|desayuno|comida|jantar|almoco|eat|dining|dine)\b/,
    "restaurant",
  ],
  [/\b(markets?|mercato|mercado|marche|markt|bazaa?r|souk|souq|feira)\b/, "market"],
  [/\b(cafes?|coffee|caffe|cafeteria|bakery|panetteria|pasticceria|patisserie|pastelaria|gelato|gelateria|ice cream|tea ?(house|room))\b/, "cafe"],
  [/\b(bars?|pubs?|wine|vino|vinho|enoteca|bodega|cocktails?|brewery|birreria|cerveceria|drinks|aperitivo)\b/, "bar"],
  [/\b(spa|thermal|terme|termas|termales|hammam|onsen|massage|hot springs?|baths|banos|sauna)\b/, "spa"],
  [/\b(shows?|theatre|theater|teatro|opera|concerts?|concerto|concierto|flamenco|fado|cinema|musical|stadium|circus|cabaret)\b/, "entertainment"],
  [/\b(nightlife|night ?clubs?|clubbing|disco|live music|jazz|karaoke)\b/, "nightlife"],
  [/\b(tours?|cruises?|crociera|crucero|cruzeiro|boat (trip|ride)|excursion|excursao|escursione|day trip|gita|safari|guided)\b/, "tour"],
  [
    /\b(class|lessons?|workshops?|course|cooking|kayak(ing)?|surf(ing)?|kitesurf(ing)?|snorkel(ing|ling)?|diving|rafting|zip ?line|atv|quad|bik(e|ing)|cycling|climbing|paragliding|ski(ing)?|yoga)\b/,
    "activity",
  ],
  [/\b(beach(es)?|spiaggia|playa|praia|plage|lido)\b/, "beach"],
  [
    /\b(hik(e|ing)|trek(king)?|trails?|volcano|vulcano|volcan|mountains?|lake|lago|waterfalls?|cascata|cascada|cachoeira|canyon|gorge|forest|bosco|bosque|floresta|national park|nature reserve|glacier|caves?|grotta|cueva|gruta|valley|desert|dunes?|geothermal|islands?|isola|isla|ilha)\b/,
    "nature",
  ],
  [/\b(parks?|parco|parque|gardens?|giardin[oi]|jardin(es)?|jardim|botanic(al)?)\b/, "park"],
  [/\b(museums?|museo|musei|museu|musee|galler(y|ies)|galleria|galeria|galerie|exhibition|mostra|pinacoteca)\b/, "museum"],
  [
    /\b(church|chiesa|iglesia|igreja|eglise|basilica|cathedral|cattedrale|catedral|duomo|chapel|temples?|tempio|templo|shrine|pagoda|stupa|mosque|synagogue|monastery|monastero|monasterio|mosteiro|abbey|abbazia|castle|castello|castillo|castelo|chateau|palace|palazzo|palacio|palais|fort|fortress|fortezza|fortaleza|citadel|tower|torre|monuments?|monumento|memorial|ruins|tomb|mausoleum|bridge|ponte|puente|lighthouse|faro|farol|statue)\b/,
    "landmark",
  ],
  [/\b(shopping|shops?|souvenirs?|mall|boutiques?|outlet|compras)\b/, "shopping"],
  [/\b(hotel|hostel|check[ -]?(in|out)|resort|ryokan|guesthouse)\b/, "accommodation"],
  [
    /\b(airport|aeroporto|aeropuerto|flight|volo|vuelo|voo|train|treno|tren|ferry|traghetto|transfer|trasferimento|traslado|departure|arrival)\b/,
    "transport",
  ],
];

/**
 * The listed type an activity is. A listed type is kept; a synonym or another
 * language maps to its own; a vague word or an unknown one is read from the
 * activity's name, then falls back to the closest type.
 */
export function normalizeActivityType(type: unknown, name?: unknown): ActivityType {
  const word = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (ON_THE_LIST.has(word)) return word as ActivityType;
  const key = activityTypeKey(word);
  if (key && ON_THE_LIST.has(key)) return key as ActivityType;
  const plain = typeof name === "string" ? name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") : "";
  const fromName = FROM_NAME.find(([pattern]) => pattern.test(plain))?.[1];
  return fromName ?? (key ? VAGUE[key] : undefined) ?? "activity";
}
