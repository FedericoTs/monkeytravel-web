/**
 * Per-trip enrichment for the lifecycle emails.
 *
 * Turns what the generator ALREADY wrote into the trip row — the weather
 * note, the highlights, the packing suggestions, the first day's plan —
 * into at most two small blocks under the email's main paragraph, chosen
 * to fit the moment each slot fires at.
 *
 * WHY THIS COSTS NOTHING
 * ----------------------
 * Every field here is read from `trips.trip_meta` and `trips.itinerary`,
 * both populated at generation time. No Gemini call, no Places call, no
 * new storage. Google Places is this product's single largest bill
 * (~$0.10/trip) and the standing decision is fewer calls per trip, not
 * more — so an enrichment that re-reads existing rows is the only version
 * of this feature worth shipping.
 *
 * EVERYTHING IS OPTIONAL, ON PURPOSE
 * ----------------------------------
 * Measured coverage across 385 live trips:
 *
 *   day-1 activities      385  (100%)
 *   weather_note          344  ( 89%)
 *   destination_best_for  344  ( 89%)
 *   highlights            271  ( 70%)
 *   packing_suggestions   268  ( 70%)
 *   must_dos               15  (  4%)  <- not used; too sparse to design around
 *
 * So a third of trips have no highlights and a tenth have no weather note.
 * A block with nothing in it is dropped rather than rendered empty, and an
 * email with zero blocks must still read as a finished email — which is why
 * this returns a list to append, never a required section.
 *
 * DEFENSIVE PARSING IS NOT PARANOIA HERE
 * --------------------------------------
 * itinerary is model-generated JSON. The codebase already carries a scar
 * from trusting its shape: `estimated_cost` was declared required, Gemini
 * omitted it, and `activity.estimated_cost.amount` threw on /trips/:id 17
 * times (Sentry JAVASCRIPT-NEXTJS-12). Everything below treats the input as
 * unknown and drops anything that is not a usable string.
 *
 * WEATHER COMES FROM AN API, NEVER FROM trip_meta
 * -----------------------------------------------
 * trip_meta.weather_note is model-generated prose that reads like data and is
 * not. Measured across 279 trips it is internally contradictory, which rules
 * out imprecision and leaves invention:
 *
 *   Kyoto in September appears as BOTH "10-18°C" and "27-32°C" on two
 *   different trips. Tokyo in November ("20-35°C") comes out hotter than
 *   Tokyo in September ("8-18°C"). Oahu in May reads "10-20°C" for an island
 *   that sits at 22-28°C year round. Rome in October reads "20-35°C".
 *
 * Six round-number buckets — 20-35, 18-30, 10-18, 8-18, 10-20, 0-10 — cover
 * 229 of the 279 trips that state a range. Tropical destinations look correct
 * only because "hot" is an easy guess. We emailed a Spanish-speaking user
 * "10-18°C" for Los Angeles on 1 September; the forecast was 22-31°C.
 *
 * So the note is never rendered. `forecastLine` carries a REAL forecast
 * instead, from lib/email/trip-forecast.ts (Open-Meteo — free, no API key, so
 * this does not touch the standing constraint on paid per-trip calls).
 *
 * An earlier version of this comment argued a per-email forecast call was the
 * wrong shape and proposed a static climate table. That was written before
 * checking the repository: app/api/weather/route.ts and
 * lib/api-gateway/clients/weather.ts already wrap Open-Meteo. Forecast also
 * beats a climate table here, because every slot fires within 14 days of the
 * trip and can therefore state what the weather WILL be rather than what it
 * usually is.
 *
 * This does NOT clean the underlying field. trip_meta.weather_note is still
 * wrong wherever else it is displayed; this only keeps it out of the emails.
 *
 * LANGUAGE — READ THIS, IT IS NOT WHAT IT LOOKS LIKE
 * --------------------------------------------------
 * Only the headings are localised, via common.emailContext. Passing them in
 * (rather than importing next-intl) keeps this module pure and unit-testable.
 *
 * Block CONTENT is never translated here, and an earlier version of this
 * comment justified that by claiming the generator already writes trip
 * content in the user's own language. That is false in a way that matters.
 *
 * The generator writes in whatever users.preferred_language said AT
 * GENERATION TIME — and that column was 'en' for all 478 users until it was
 * repaired on 2026-08-27 (see app/auth/callback/route.ts for the signup bug
 * that caused it). Measured immediately after that repair: 63 users now hold
 * es/it/pt, they own 57 trips between them, and ZERO of those trips were
 * created after the repair.
 *
 * So for every one of them the email shell is correctly Spanish or Italian
 * while these blocks are English:
 *
 *   [El tiempo durante tu viaje] Expected cool temperatures (10-18°C)…
 *
 * That is a deliberate accepted state, not an oversight. It is strictly
 * better than the fully-English email those users received before, it costs
 * no Gemini call to leave alone, and it self-heals: the next trip they
 * generate comes out in their real language. Anyone tempted to "fix" it by
 * translating at send time should price the per-email model call first —
 * fewer calls per trip is a standing constraint on this product.
 */

/**
 * The only slots whose blocks can render a forecast.
 *
 * Callers gate the Open-Meteo lookup on this so the other four slots do not
 * pay for an answer nothing reads. That is not tidiness: the cron may process
 * MAX_ROWS_PER_RUN (200) rows inside a 60s function, and three in five of
 * those rows would otherwise spend up to TIMEOUT_MS on a call whose result is
 * discarded a few lines later.
 *
 * It is exported — rather than each caller carrying its own list — because it
 * is a fact about the switch below, and a copy of it elsewhere would silently
 * stop matching the day a slot is added. The unit tests assert the two agree.
 */
export const FORECAST_SLOTS: ReadonlySet<string> = new Set([
  "pack_early_14d",
  "weather_3d",
]);

/** One row in a list block. `meta` renders muted, to the right. */
export interface ContextItem {
  text: string;
  meta?: string;
}

/** A titled block: either a short prose note, or a list, never both. */
export interface ContextBlock {
  label: string;
  note?: string;
  items?: ContextItem[];
}

/** The six localised headings, from common.emailContext. */
export interface ContextLabels {
  weather: string;
  packing: string;
  goingFor: string;
  dayOne: string;
  today: string;
  yourHighlights: string;
}

/**
 * Raw slices pulled straight from the trip row. Deliberately `unknown` —
 * these come from jsonb and the caller should not have to pre-validate.
 */
export interface TripContextSource {
  /**
   * Real forecast, already formatted AND localised by the caller — e.g.
   * "22–32°C · no rain expected". Built from Open-Meteo in
   * lib/email/trip-forecast.ts, so unlike weatherNote every number in it came
   * from an API. Passed in pre-rendered for the same reason the labels are:
   * this module stays pure and free of next-intl.
   *
   * Absent whenever the lookup could not answer — no coordinates, a timeout,
   * dates beyond the 16-day horizon. Absent means no block, never a guess.
   */
  forecastLine?: unknown;
  /**
   * DEPRECATED as an email source. Still accepted so callers need not change
   * shape, but never rendered — see the header. Kept in the type because it
   * remains in trips.trip_meta and someone will otherwise "helpfully" wire it
   * back up.
   */
  weatherNote?: unknown;
  highlights?: unknown;
  packingSuggestions?: unknown;
  /** The first element of `trips.itinerary` — the day-1 object. */
  day1?: unknown;
}

// Length caps. An email is skim-read on a phone; these keep a block to a
// glance and stop a runaway generation from producing a wall of text.
const MAX_NOTE = 240;
const MAX_ITEM = 80;
const MAX_META = 40;
const MAX_LIST_ITEMS = 3;
const MAX_PACKING_ITEMS = 4;
/** Two is the ceiling: past that the block stack outweighs the message. */
const MAX_BLOCKS = 2;

/** A usable string, trimmed and capped, or undefined. */
function str(value: unknown, cap: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= cap) return trimmed;
  // Cut on a word boundary where one is close, so the ellipsis does not
  // land mid-word.
  const slice = trimmed.slice(0, cap);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > cap * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

/** Strings out of an unknown jsonb array, capped and de-duplicated. */
function stringList(value: unknown, limit: number): ContextItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ContextItem[] = [];
  for (const raw of value) {
    const text = str(raw, MAX_ITEM);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Day-1 activities as "name" + a time hint.
 *
 * Prefers `start_time` ("09:30") and falls back to `time_slot`
 * ("morning") — the generator emits one or the other depending on how the
 * day was planned, and neither is guaranteed.
 */
function dayActivities(day: unknown, limit: number): ContextItem[] {
  if (!day || typeof day !== "object") return [];
  const activities = (day as Record<string, unknown>).activities;
  if (!Array.isArray(activities)) return [];

  const out: ContextItem[] = [];
  for (const raw of activities) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const text = str(a.name, MAX_ITEM);
    if (!text) continue;
    const meta = str(a.start_time, MAX_META) ?? str(a.time_slot, MAX_META);
    out.push(meta ? { text, meta } : { text });
    if (out.length >= limit) break;
  }
  return out;
}

/** Drop blocks that ended up with nothing to show, then cap the count. */
function compact(blocks: Array<ContextBlock | null>): ContextBlock[] {
  return blocks
    .filter((b): b is ContextBlock => {
      if (!b) return false;
      return Boolean(b.note) || (b.items?.length ?? 0) > 0;
    })
    .slice(0, MAX_BLOCKS);
}

/**
 * Choose the enrichment for a slot.
 *
 * The mapping is the whole point: each slot gets the thing that is useful
 * at that exact moment, not a generic "about your trip" box.
 *
 *   pack_early_14d   weather + what to pack   — the packing email
 *   visa_check_7d    what you're going for    — motivation, not logistics
 *   weather_3d       the weather note         — the email is literally this
 *   confirm_1d       day one                  — what you land into
 *   morning_of       today's plan             — same day, different framing
 *   return_3d        your highlights          — what you just did
 *
 * The later followup slots get nothing. They exist to be short, and a
 * recap of a trip six weeks gone would work against "we won't keep
 * nudging".
 */
export function buildContextBlocks(
  slot: string,
  src: TripContextSource,
  labels: ContextLabels
): ContextBlock[] {
  // Deliberately reads forecastLine, NOT weatherNote. The latter is invented;
  // see the header.
  const forecast = str(src.forecastLine, MAX_NOTE);

  switch (slot) {
    case "pack_early_14d":
      // Forecast first — it is what makes the packing list actionable. Both
      // blocks are optional, so this renders as weather-only, packing-only,
      // or nothing at all.
      return compact([
        forecast ? { label: labels.weather, note: forecast } : null,
        {
          label: labels.packing,
          items: stringList(src.packingSuggestions, MAX_PACKING_ITEMS),
        },
      ]);

    case "visa_check_7d":
      return compact([
        {
          label: labels.goingFor,
          items: stringList(src.highlights, MAX_LIST_ITEMS),
        },
      ]);

    case "weather_3d":
      // This slot's entire reason to exist. With a real forecast it can now
      // answer the question its copy asks; without one it renders bare rather
      // than inventing an answer.
      return compact([forecast ? { label: labels.weather, note: forecast } : null]);

    case "confirm_1d":
      return compact([
        { label: labels.dayOne, items: dayActivities(src.day1, MAX_LIST_ITEMS) },
      ]);

    case "morning_of":
      return compact([
        { label: labels.today, items: dayActivities(src.day1, MAX_LIST_ITEMS) },
      ]);

    case "followup_return_3d":
      return compact([
        {
          label: labels.yourHighlights,
          items: stringList(src.highlights, MAX_LIST_ITEMS),
        },
      ]);

    default:
      // followup_next_21d / followup_final_45d / followup_dormant, and any
      // future slot that has not opted in. Silence is the safe default.
      return [];
  }
}
