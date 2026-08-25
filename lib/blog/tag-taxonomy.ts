/**
 * The controlled tag vocabulary for the blog.
 *
 * WHY IT EXISTS
 * Tags used to be authored free-form per post, which produced 276-296 distinct
 * tags per locale across 84 posts, 84-88% of them appearing exactly ONCE. A
 * singleton tag is dead weight twice over: it can never match a related post
 * (that needs two posts to share it) and its archive page is noindexed as thin
 * (TAG_MIN_POSTS_FOR_INDEX = 5). Only 4-8 tag pages per locale cleared that bar.
 *
 * The styles were also mixed: short conceptual tags ("outono", "sazonal")
 * alongside long-tail keyword tags ("viagens outono 2026", "viajar em outubro").
 * Posts written in the two styles could never match each other, which is why
 * best-fall-foliage-destinations shared no tag at all with where-to-go-in-october.
 *
 * Each post now draws 3-6 concepts from the fixed taxonomy below, rendered into
 * each locale's own language, plus destination tags where the post is about one
 * specific city.
 *
 * WHERE THE SOURCE OF TRUTH LIVES
 * Post frontmatter, still — the app reads tags from the markdown and nothing
 * here runs at request time. This module is the definition that
 * scripts/normalize-blog-tags.mts writes INTO the frontmatter, kept in lib/ so
 * it is typechecked and so lib/blog/tag-taxonomy.vitest.ts can assert the files
 * on disk still match it.
 *
 * TWO INVARIANTS THE TAXONOMY MUST PRESERVE
 * 1. Destination tags feed getPrimaryDestinationFromTags (the "plan this trip"
 *    CTA) and lib/cross-links. Every destination tag that existed before the
 *    normalization is preserved; the pass only ADDED them to single-destination
 *    posts that were missing one. No live CTA was turned off.
 * 2. Tag archive URLs that Google has indexed must not evaporate. Display
 *    strings were chosen so every previously-indexed slug survives unchanged,
 *    except five renamed for correctness and redirected via lib/blog/retired-tags.ts.
 */

export const LOCALES = ["en", "it", "es", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Display strings per locale. The strings for `itinerary`, `city-guide`,
 * `budget-travel`, `ai-trip-planner` and `seasonal` (and their it/es/pt
 * equivalents) are deliberately identical to tags already in use, so their
 * indexed archive URLs survive this pass untouched.
 */
export const CONCEPTS: Record<string, Record<Locale, string>> = {
  // --- format / article type ---
  "itinerary":          { en: "itinerary",            it: "itinerario",               es: "itinerario",               pt: "roteiro" },
  "city-guide":         { en: "city guide",           it: "guida città",              es: "guía de ciudad",           pt: "guia da cidade" },
  "comparison":         { en: "comparison",           it: "confronto",                es: "comparación",              pt: "comparação" },
  "review":             { en: "review",               it: "recensione",               es: "reseña",                   pt: "avaliação" },
  "travel-data":        { en: "travel data",          it: "dati di viaggio",          es: "datos de viaje",           pt: "dados de viagem" },
  "best-destinations":  { en: "best destinations",    it: "migliori destinazioni",    es: "mejores destinos",         pt: "melhores destinos" },
  "travel-checklist":   { en: "travel checklist",     it: "checklist di viaggio",     es: "checklist de viaje",       pt: "checklist de viagem" },
  "monthly-guide":      { en: "monthly travel guide", it: "guida mensile ai viaggi",  es: "guía mensual de viajes",   pt: "guia mensal de viagens" },

  // --- theme ---
  "budget-travel":      { en: "budget travel",        it: "viaggi economici",         es: "viajes económicos",        pt: "viagem econômica" },
  "group-travel":       { en: "group travel",         it: "viaggi di gruppo",         es: "viajes en grupo",          pt: "viagem em grupo" },
  "solo-travel":        { en: "solo travel",          it: "viaggi in solitaria",      es: "viajes en solitario",      pt: "viagem sozinho" },
  "romantic-travel":    { en: "romantic travel",      it: "viaggi romantici",         es: "viajes románticos",        pt: "viagens românticas" },
  "food-travel":        { en: "food travel",          it: "viaggi enogastronomici",   es: "viajes gastronómicos",     pt: "viagem gastronômica" },
  "wellness-travel":    { en: "wellness travel",      it: "viaggi benessere",         es: "viajes de bienestar",      pt: "viagem de bem-estar" },
  "sustainable-travel": { en: "sustainable travel",   it: "viaggi sostenibili",       es: "viajes sostenibles",       pt: "viagem sustentável" },
  "digital-nomad":      { en: "digital nomad",        it: "nomadi digitali",          es: "nómadas digitales",        pt: "nômades digitais" },
  "nature-travel":      { en: "nature travel",        it: "viaggi nella natura",      es: "viajes de naturaleza",     pt: "viagem na natureza" },

  // --- region ---
  "europe":             { en: "europe",               it: "europa",                   es: "europa",                   pt: "europa" },
  "asia":               { en: "asia",                 it: "asia",                     es: "asia",                     pt: "ásia" },
  "italy":              { en: "italy",                it: "italia",                   es: "italia",                   pt: "itália" },
  "japan":              { en: "japan",                it: "giappone",                 es: "japón",                    pt: "japão" },
  "united-states":      { en: "united states",        it: "stati uniti",              es: "estados unidos",           pt: "estados unidos" },

  // --- timing ---
  "seasonal":           { en: "seasonal",             it: "stagionale",               es: "estacional",               pt: "sazonal" },
  "shoulder-season":    { en: "shoulder season",      it: "mezza stagione",           es: "temporada media",          pt: "meia-estação" },
  "spring-travel":      { en: "spring travel",        it: "viaggi di primavera",      es: "viajes de primavera",      pt: "viagem de primavera" },
  "summer-travel":      { en: "summer travel",        it: "viaggi estivi",            es: "viajes de verano",         pt: "viagem de verão" },
  "autumn-travel":      { en: "autumn travel",        it: "viaggi autunnali",         es: "viajes de otoño",          pt: "viagem de outono" },
  "winter-travel":      { en: "winter travel",        it: "viaggi invernali",         es: "viajes de invierno",       pt: "viagem de inverno" },

  // --- ai / technology ---
  "ai-trip-planner":    { en: "ai trip planner",      it: "pianificatore di viaggio ai", es: "planificador de viajes con ai", pt: "planejador de viagens com ia" },
  "travel-technology":  { en: "travel technology",    it: "tecnologia di viaggio",    es: "tecnología de viajes",     pt: "tecnologia de viagens" },

  // --- practical ---
  "travel-documents":   { en: "travel documents",     it: "documenti di viaggio",     es: "documentos de viaje",      pt: "documentos de viagem" },
  "travel-safety":      { en: "travel safety",        it: "sicurezza in viaggio",     es: "seguridad en viajes",      pt: "segurança em viagens" },
  "first-time-travel":  { en: "first time travel",    it: "primo viaggio",            es: "primer viaje",             pt: "primeira viagem" },

  // --- trip shape ---
  "weekend-trip":       { en: "weekend trip",         it: "viaggio weekend",          es: "viaje de fin de semana",   pt: "viagem de fim de semana" },
  "week-long-trip":     { en: "week-long trip",       it: "viaggio di una settimana", es: "viaje de una semana",      pt: "viagem de uma semana" },
  "multi-city-trip":    { en: "multi-city trip",      it: "viaggio multi-città",      es: "viaje multiciudad",        pt: "viagem multicidade" },
  "trip-planning":      { en: "trip planning",        it: "pianificazione viaggi",    es: "planificación de viajes",  pt: "planejamento de viagem" },
};

/**
 * Localized city names, mirrored from lib/destinations/data.ts.
 *
 * Duplicated rather than imported because that module is marked `server-only`
 * and carries the whole ~3k-line destination dataset, which this definition has
 * no need to drag in. lib/blog/tag-taxonomy.vitest.ts asserts every name here
 * still matches the real data, so the copy cannot drift silently.
 */
export const DESTINATION_NAMES: Record<string, Record<Locale, string>> = {
  "paris":     { en: "Paris",     es: "París",      it: "Parigi",     pt: "Paris" },
  "rome":      { en: "Rome",      es: "Roma",       it: "Roma",       pt: "Roma" },
  "barcelona": { en: "Barcelona", es: "Barcelona",  it: "Barcellona", pt: "Barcelona" },
  "tokyo":     { en: "Tokyo",     es: "Tokio",      it: "Tokyo",      pt: "Tóquio" },
  "new-york":  { en: "New York",  es: "Nueva York", it: "New York",   pt: "Nova York" },
  "london":    { en: "London",    es: "Londres",    it: "Londra",     pt: "Londres" },
  "lisbon":    { en: "Lisbon",    es: "Lisboa",     it: "Lisbona",    pt: "Lisboa" },
  "bangkok":   { en: "Bangkok",   es: "Bangkok",    it: "Bangkok",    pt: "Bangkok" },
  "bali":      { en: "Bali",      es: "Bali",       it: "Bali",       pt: "Bali" },
  "seoul":     { en: "Seoul",     es: "Seúl",       it: "Seul",       pt: "Seul" },
  "istanbul":  { en: "Istanbul",  es: "Estambul",   it: "Istanbul",   pt: "Istambul" },
  "kyoto":     { en: "Kyoto",     es: "Kioto",      it: "Kyoto",      pt: "Quioto" },
};

/**
 * Per-post assignment. `d` lists destination slugs and is only set where the
 * post is about one specific city — multi-destination roundups and region
 * guides deliberately get none, so the CTA stays suppressed rather than
 * claiming a post about ten places is a post about one.
 *
 * The `d` entries on 5-day-italy-itinerary, japan-cherry-blossom-season-guide,
 * paris-vs-barcelona, paris-vs-rome and tokyo-vs-seoul reproduce destination
 * tags that are already live today; they are preserved, not newly asserted.
 */
export const POSTS: Record<string, { c: string[]; d?: string[] }> = {
  // --- AI Travel ---
  "ai-trip-planner-accuracy-2026":         { c: ["ai-trip-planner", "travel-data", "travel-technology", "trip-planning"] },
  "ai-trip-planner-vs-travel-agent":       { c: ["ai-trip-planner", "comparison", "travel-technology", "trip-planning"] },
  "best-ai-trip-planners-2026-compared":   { c: ["ai-trip-planner", "comparison", "review", "travel-technology"] },
  "can-you-trust-ai-travel-itinerary":     { c: ["ai-trip-planner", "travel-technology", "trip-planning", "itinerary"] },
  "how-ai-is-changing-travel-planning":    { c: ["ai-trip-planner", "travel-technology", "trip-planning"] },
  "how-to-plan-a-trip-with-ai":            { c: ["ai-trip-planner", "trip-planning", "first-time-travel"] },
  "layla-ai-review-2026":                  { c: ["ai-trip-planner", "review", "comparison", "travel-technology"] },
  "mindtrip-review-2026":                  { c: ["ai-trip-planner", "review", "comparison", "travel-technology"] },
  "plan-weekend-getaway-with-ai":          { c: ["ai-trip-planner", "weekend-trip", "trip-planning", "itinerary"] },
  "q3-2026-travel-planning-report":        { c: ["travel-data", "trip-planning", "group-travel"] },
  "travel-planning-trends-2026":           { c: ["travel-data", "trip-planning", "ai-trip-planner"] },
  "wanderlog-alternative-2026":            { c: ["ai-trip-planner", "review", "comparison", "travel-technology"] },
  "ai-trip-planners-without-signup-2026":  { c: ["ai-trip-planner", "review", "comparison", "travel-technology"] },
  "layla-vs-mindtrip-2026":                { c: ["ai-trip-planner", "review", "comparison", "travel-technology"] },
  "layla-vs-wonderplan-vs-lonely-planet": { c: ["ai-trip-planner", "review", "comparison", "travel-technology"] },
  "mindtrip-alternative-2026":             { c: ["ai-trip-planner", "review", "comparison", "travel-technology"] },
  "wanderlog-vs-mindtrip-2026":            { c: ["ai-trip-planner", "review", "comparison", "travel-technology"] },
  "wonderplan-review-2026":                { c: ["ai-trip-planner", "review", "comparison", "travel-technology"] },

  // --- Budget Travel ---
  "cheapest-destinations-in-asia":         { c: ["budget-travel", "best-destinations", "asia"] },
  "cheapest-destinations-in-europe":       { c: ["budget-travel", "best-destinations", "europe"] },
  "cheapest-european-cities-for-food-2026": { c: ["budget-travel", "food-travel", "europe", "best-destinations"] },
  "cheapest-flights-2026-when-and-where-to-book": { c: ["budget-travel", "trip-planning"] },
  "how-to-plan-trip-to-italy-on-a-budget": { c: ["budget-travel", "italy", "europe", "itinerary", "trip-planning"] },

  // --- Destination Guides ---
  "3-day-paris-itinerary":                 { c: ["itinerary", "city-guide", "europe", "weekend-trip"], d: ["paris"] },
  "5-day-italy-itinerary":                 { c: ["itinerary", "italy", "europe", "week-long-trip", "multi-city-trip"], d: ["rome"] },
  "bali-7-day-itinerary":                  { c: ["itinerary", "asia", "week-long-trip"], d: ["bali"] },
  "bali-vs-thailand":                      { c: ["comparison", "asia", "budget-travel", "best-destinations"] },
  "bangkok-5-day-itinerary":               { c: ["itinerary", "city-guide", "asia", "week-long-trip"], d: ["bangkok"] },
  "barcelona-3-day-itinerary":             { c: ["itinerary", "city-guide", "europe", "weekend-trip"], d: ["barcelona"] },
  "best-food-destinations-2026":           { c: ["food-travel", "best-destinations"] },
  "best-group-trip-destinations-2026":     { c: ["group-travel", "best-destinations"] },
  "fifa-world-cup-2026-travel-guide":      { c: ["multi-city-trip", "united-states", "trip-planning"] },
  "first-trip-to-japan-what-you-need-to-know": { c: ["first-time-travel", "japan", "asia", "trip-planning"] },
  "first-trip-to-vietnam-2026":            { c: ["first-time-travel", "asia", "itinerary", "budget-travel"] },
  "greek-island-hopping-itinerary":        { c: ["itinerary", "europe", "week-long-trip", "multi-city-trip"] },
  "istanbul-3-day-itinerary":              { c: ["itinerary", "city-guide", "weekend-trip"], d: ["istanbul"] },
  "itinerario-puglia-5-giorni":            { c: ["itinerary", "italy", "europe", "week-long-trip"] },
  "itinerario-sardegna-7-giorni":          { c: ["itinerary", "italy", "europe", "week-long-trip"] },
  "japan-golden-route-itinerary":          { c: ["itinerary", "japan", "asia", "multi-city-trip", "week-long-trip"] },
  "lisbon-3-day-itinerary":                { c: ["itinerary", "city-guide", "europe", "weekend-trip"], d: ["lisbon"] },
  "lisbon-vs-porto":                       { c: ["comparison", "city-guide", "europe"] },
  "london-4-day-itinerary":                { c: ["itinerary", "city-guide", "europe", "weekend-trip"], d: ["london"] },
  "new-york-5-day-itinerary":              { c: ["itinerary", "city-guide", "united-states", "week-long-trip"], d: ["new-york"] },
  "paris-vs-barcelona":                    { c: ["comparison", "city-guide", "europe"], d: ["barcelona"] },
  "paris-vs-rome":                         { c: ["comparison", "city-guide", "europe"], d: ["rome"] },
  "seoul-5-day-itinerary":                 { c: ["itinerary", "city-guide", "asia", "week-long-trip"], d: ["seoul"] },
  "tokyo-4-day-itinerary":                 { c: ["itinerary", "city-guide", "japan", "asia", "weekend-trip"], d: ["tokyo"] },
  "tokyo-vs-seoul":                        { c: ["comparison", "city-guide", "asia"], d: ["seoul"] },

  // --- Seasonal Travel ---
  "2026-travel-calendar":                  { c: ["seasonal", "monthly-guide", "trip-planning"] },
  "best-fall-foliage-destinations":        { c: ["seasonal", "autumn-travel", "nature-travel", "best-destinations"] },
  "best-places-to-see-northern-lights":    { c: ["seasonal", "winter-travel", "nature-travel", "best-destinations", "europe"] },
  "great-migration-africa-when-and-where": { c: ["seasonal", "nature-travel", "best-destinations"] },
  "japan-cherry-blossom-season-guide":     { c: ["seasonal", "spring-travel", "japan", "asia"], d: ["tokyo", "kyoto"] },
  "midnight-sun-best-destinations":        { c: ["seasonal", "summer-travel", "nature-travel", "best-destinations", "europe"] },
  "monsoon-season-where-to-go-and-avoid":  { c: ["seasonal", "asia", "budget-travel"] },
  "spring-summer-travel-guide":            { c: ["seasonal", "spring-travel", "summer-travel", "shoulder-season", "best-destinations"] },
  "where-to-go-in-april":                  { c: ["seasonal", "monthly-guide", "spring-travel", "shoulder-season", "best-destinations"] },
  "where-to-go-in-august":                 { c: ["seasonal", "monthly-guide", "summer-travel", "best-destinations"] },
  "where-to-go-in-december":               { c: ["seasonal", "monthly-guide", "winter-travel", "best-destinations"] },
  "where-to-go-in-november":               { c: ["seasonal", "monthly-guide", "autumn-travel", "shoulder-season", "best-destinations"] },
  "where-to-go-in-october":                { c: ["seasonal", "monthly-guide", "autumn-travel", "shoulder-season", "best-destinations"] },
  "where-to-go-in-september":              { c: ["seasonal", "monthly-guide", "autumn-travel", "shoulder-season", "best-destinations"] },

  // --- Travel Tips ---
  "chatgpt-vs-ai-trip-planners":           { c: ["ai-trip-planner", "comparison", "travel-technology"] },
  "etias-europe-travel-authorization-2026": { c: ["travel-documents", "europe", "trip-planning"] },
  "international-travel-checklist":        { c: ["travel-checklist", "first-time-travel", "trip-planning"] },
  "is-it-safe-to-travel-to-the-us-2026":   { c: ["travel-safety", "united-states", "travel-documents"] },
  "passport-power-index-2026":             { c: ["travel-documents", "travel-data"] },
  "solo-female-travel-safety-guide-2026":  { c: ["solo-travel", "travel-safety"] },
  "solo-travel-planning-with-ai":          { c: ["solo-travel", "ai-trip-planner", "trip-planning"] },
  "travel-packing-checklist":              { c: ["travel-checklist", "trip-planning"] },
  "travel-planning-stress-how-ai-helps":   { c: ["ai-trip-planner", "trip-planning"] },
  "visa-free-destinations-by-passport":    { c: ["travel-documents", "best-destinations"] },
  "visa-requirements-us-citizens":         { c: ["travel-documents", "united-states"] },

  // --- Trip Planning ---
  "best-digital-nomad-destinations-2026":  { c: ["digital-nomad", "best-destinations", "trip-planning"] },
  "best-honeymoon-destinations-2026":      { c: ["romantic-travel", "best-destinations"] },
  "best-wellness-retreats-2026":           { c: ["wellness-travel", "best-destinations"] },
  "group-travel-mistakes-to-avoid":        { c: ["group-travel", "trip-planning"] },
  "group-travel-statistics-2026":          { c: ["group-travel", "travel-data", "trip-planning"] },
  "group-trip-budget-how-to-split-costs":  { c: ["group-travel", "budget-travel", "trip-planning"] },
  "group-trip-itinerary-template":         { c: ["group-travel", "itinerary", "trip-planning"] },
  "honeymoon-planning-guide":              { c: ["romantic-travel", "trip-planning"] },
  "how-long-should-a-trip-be":             { c: ["travel-data", "trip-planning"] },
  "how-many-activities-per-day-itinerary": { c: ["itinerary", "travel-data", "trip-planning"] },
  "how-to-plan-a-bachelorette-trip":       { c: ["group-travel", "trip-planning"] },
  "how-to-plan-a-group-trip":              { c: ["group-travel", "trip-planning"] },
  "how-to-plan-a-multi-city-trip":         { c: ["multi-city-trip", "itinerary", "trip-planning"] },
  "most-planned-destinations-2026":        { c: ["travel-data", "best-destinations", "multi-city-trip"] },
  "plan-group-trip-by-voting":             { c: ["group-travel", "itinerary", "trip-planning"] },
  "sustainable-travel-guide-2026":         { c: ["sustainable-travel", "trip-planning", "best-destinations"] },
  "travel-moods-2026":                     { c: ["travel-data", "trip-planning"] },
};

export function tagsFor(slug: string, locale: Locale): string[] {
  const post = POSTS[slug];
  if (!post) throw new Error(`no assignment for ${slug}`);
  const concept = post.c.map((k) => {
    const c = CONCEPTS[k];
    if (!c) throw new Error(`unknown concept "${k}" on ${slug}`);
    return c[locale];
  });
  const dest = (post.d ?? []).map((d) => {
    const n = DESTINATION_NAMES[d];
    if (!n) throw new Error(`unknown destination "${d}" on ${slug}`);
    return n[locale].toLowerCase();
  });
  return [...concept, ...dest];
}
