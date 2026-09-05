/**
 * Backfill trip_meta.locale and repair mixed-language trips.
 * Live Trip plan, Phase 1.3 ("locale-consistent itineraries").
 *
 * What it does, per trip (deleted_at IS NULL, has an itinerary):
 *   1. detects the language of every day (lib/ai/detect-language.ts —
 *      stopword scoring over the day's prose, names excluded);
 *   2. the trip's language = the language of most of its prose. If
 *      trip_meta.locale is missing, stamp it (never overrides an existing
 *      value unless --force);
 *   3. a day confidently in ANOTHER language is "mixed". For public trips
 *      (public_slug set) — or every trip with --all-mixed — the day's prose
 *      is translated into the trip's language with Gemini, structure and
 *      ids untouched, validated, and written back.
 *
 * Dry-run by default: prints the plan and the before/after counts.
 *
 *   npx tsx scripts/backfill-trip-locale.mts                # report only
 *   npx tsx scripts/backfill-trip-locale.mts --apply        # stamp + repair public
 *   npx tsx scripts/backfill-trip-locale.mts --apply --all-mixed
 *   npx tsx scripts/backfill-trip-locale.mts --trip <uuid> [--apply]
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, and
 * GOOGLE_AI_API_KEY for translations (env or .env.local). Every row it
 * rewrites is saved first under --backup-dir (default: OS temp).
 */
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// package.json has no "type": "module", so tsx hands these .ts modules to
// an .mts script as CommonJS and only a `default` namespace survives — the
// same reason the other scripts import lib modules as namespaces.
import * as DetectMod from "../lib/ai/detect-language";
import * as LangMod from "../lib/ai/language";
import type { SupportedLanguage } from "../lib/ai/language";

const unwrap = <T,>(mod: unknown, key: string): T => {
  const m = mod as Record<string, unknown> & { default?: Record<string, unknown> };
  return (m[key] ?? m.default?.[key]) as T;
};
const detectLanguage = unwrap<typeof DetectMod.detectLanguage>(DetectMod, "detectLanguage");
const itineraryDayText = unwrap<typeof DetectMod.itineraryDayText>(DetectMod, "itineraryDayText");
const isSupportedLanguage = unwrap<typeof LangMod.isSupportedLanguage>(LangMod, "isSupportedLanguage");
if (!detectLanguage || !itineraryDayText || !isSupportedLanguage) {
  throw new Error("lib/ai modules did not load — check the tsx loader");
}

// ---------------------------------------------------------------- env
const env: Record<string, string> = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const need = (k: string) => process.env[k] ?? env[k] ?? "";
const SUPABASE_URL = need("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const GEMINI_KEY = need("GOOGLE_AI_API_KEY");
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = flag("--apply");
const FORCE = flag("--force");
const ALL_MIXED = flag("--all-mixed");
const ONLY_TRIP = opt("--trip");
const LIMIT = Number(opt("--limit") ?? 0);
const MODEL = opt("--model") ?? "gemini-2.5-flash";
const BACKUP_DIR = opt("--backup-dir") ?? join(tmpdir(), "monkeytravel-backfill-trip-locale");
const LANG_NAME: Record<SupportedLanguage, string> = { en: "English", es: "Spanish", it: "Italian", pt: "Portuguese" };

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------- shapes
type Row = {
  id: string;
  title: string;
  itinerary: unknown;
  trip_meta: Record<string, unknown> | null;
  public_slug: string | null;
  visibility: string | null;
};

/** trips.itinerary is stored as the days array; tolerate {days:[...]} too. */
function daysOf(itinerary: unknown): { days: unknown[]; wrapped: boolean } {
  if (Array.isArray(itinerary)) return { days: itinerary, wrapped: false };
  const d = (itinerary as { days?: unknown } | null)?.days;
  return Array.isArray(d) ? { days: d, wrapped: true } : { days: [], wrapped: false };
}

interface DayGuess {
  index: number;
  dayNumber: unknown;
  language: SupportedLanguage | null;
  tokens: number;
}

function analyse(days: unknown[]): { guesses: DayGuess[]; dominant: SupportedLanguage | null } {
  const guesses: DayGuess[] = days.map((day, index) => {
    const g = detectLanguage(itineraryDayText(day));
    return { index, dayNumber: (day as { day_number?: unknown })?.day_number ?? index + 1, language: g.language, tokens: g.tokens };
  });
  // dominant = language carrying the most prose (tokens), among confident days
  const weight = new Map<SupportedLanguage, number>();
  for (const g of guesses) if (g.language) weight.set(g.language, (weight.get(g.language) ?? 0) + g.tokens);
  let dominant: SupportedLanguage | null = null;
  let best = 0;
  for (const [l, w] of weight) if (w > best) { best = w; dominant = l; }
  return { guesses, dominant };
}

// ---------------------------------------------------------------- translate
const PROSE_KEYS_DAY = ["title", "theme", "summary", "notes", "tips", "why"];
const PROSE_KEYS_ACT = ["description", "tips", "notes", "why", "booking_note"];

async function translateDay(day: unknown, from: SupportedLanguage, to: SupportedLanguage): Promise<unknown | null> {
  if (!GEMINI_KEY) throw new Error("GOOGLE_AI_API_KEY missing — cannot translate");
  const model = new GoogleGenerativeAI(GEMINI_KEY).getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
  });
  const prompt =
    `You are fixing one day of a travel itinerary that was written in ${LANG_NAME[from]} inside a trip whose language is ${LANG_NAME[to]}.\n` +
    `Translate ONLY the user-facing prose into ${LANG_NAME[to]}: the day's ${PROSE_KEYS_DAY.join(", ")} and each activity's ${PROSE_KEYS_ACT.join(", ")}.\n` +
    `Keep EVERYTHING else byte-for-byte identical: every key, id, day_number, date, time_slot, start_time, duration_minutes, name, location, address, coordinates, google_place_id, costs, currency, URLs, arrays and their order. Proper nouns and place names stay as they are.\n` +
    `Return the same JSON object, nothing else.\n\n` +
    JSON.stringify(day);
  // Two attempts: the second repeats the invariants more firmly. Activity
  // names and locations MAY change — an Italian sentence used as a name
  // ("Passeggiata nel centro storico") is part of the mixed-language
  // problem; ids, times, place ids and coordinates are the hard invariants.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await model.generateContent(
      attempt === 0
        ? prompt
        : prompt + "\n\nREMINDER: same number of activities, in the same order; ids, day_number, date, start_time, time_slot, duration_minutes, google_place_id, coordinates and address must be identical to the input.",
    );
    const text = res.response.text();
    let out: unknown;
    try {
      out = JSON.parse(text);
    } catch {
      continue;
    }
    const why = shapeProblem(day, out);
    if (!why) return out;
    console.log(`  attempt ${attempt + 1}: ${why}`);
  }
  return null;
}

/** null when the shape is intact; otherwise what changed that must not. */
function shapeProblem(before: unknown, after: unknown): string | null {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  if (!a || typeof a !== "object") return "not an object";
  if (b.day_number !== a.day_number) return "day_number changed";
  const ba = Array.isArray(b.activities) ? (b.activities as Record<string, unknown>[]) : [];
  const aa = Array.isArray(a.activities) ? (a.activities as Record<string, unknown>[]) : [];
  if (ba.length !== aa.length) return `activity count ${ba.length} → ${aa.length}`;
  for (let i = 0; i < ba.length; i++) {
    for (const k of ["id", "start_time", "time_slot", "duration_minutes", "google_place_id", "coordinates", "address"]) {
      if (JSON.stringify(ba[i][k] ?? null) !== JSON.stringify(aa[i][k] ?? null)) return `activity ${i + 1} ${k} changed`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- main
async function loadTrips(): Promise<Row[]> {
  const rows: Row[] = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("trips")
      .select("id, title, itinerary, trip_meta, public_slug, visibility")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (ONLY_TRIP) q = q.eq("id", ONLY_TRIP);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE || ONLY_TRIP) break;
    if (LIMIT && rows.length >= LIMIT) break;
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY" : "dry-run"}${ALL_MIXED ? " (repair mixed days on ALL trips)" : " (repair mixed days on PUBLIC trips)"}${FORCE ? " (force re-stamp)" : ""}`);
  const trips = await loadTrips();
  console.log(`trips scanned: ${trips.length}`);

  const stats = {
    withItinerary: 0,
    undetectable: 0,
    alreadyStamped: 0,
    toStamp: 0,
    stamped: 0,
    mixedTrips: 0,
    mixedPublicTrips: 0,
    mixedDays: 0,
    translated: 0,
    translationRejected: 0,
    stillMixedPublic: 0,
    stampMismatch: 0,
  };
  const byLocale = new Map<string, number>();
  if (APPLY) mkdirSync(BACKUP_DIR, { recursive: true });

  for (const trip of trips) {
    const { days, wrapped } = daysOf(trip.itinerary);
    if (days.length === 0) continue;
    stats.withItinerary++;
    const { guesses, dominant } = analyse(days);
    if (!dominant) { stats.undetectable++; continue; }
    byLocale.set(dominant, (byLocale.get(dominant) ?? 0) + 1);

    const meta = { ...(trip.trip_meta ?? {}) } as Record<string, unknown>;
    const existing = isSupportedLanguage(meta.locale) ? meta.locale : null;
    const isPublic = !!trip.public_slug;
    const mixed = guesses.filter((g) => g.language && g.language !== dominant);
    if (existing && existing !== dominant) stats.stampMismatch++;

    let metaChanged = false;
    if (!existing || FORCE) {
      if (existing !== dominant) { stats.toStamp++; meta.locale = dominant; metaChanged = true; }
    } else {
      stats.alreadyStamped++;
    }

    let daysChanged = false;
    let newDays = days;
    if (mixed.length > 0) {
      stats.mixedTrips++;
      if (isPublic) stats.mixedPublicTrips++;
      stats.mixedDays += mixed.length;
      const label = `${trip.id} "${trip.title}"${isPublic ? ` [public /trip/${trip.public_slug}]` : ""}`;
      console.log(`mixed: ${label} → ${dominant}; days ${mixed.map((m) => `${m.dayNumber}:${m.language}`).join(", ")}`);
      if (APPLY && (isPublic || ALL_MIXED)) {
        newDays = [...days];
        for (const m of mixed) {
          const fixed = await translateDay(days[m.index], m.language!, dominant);
          if (fixed) { newDays[m.index] = fixed; daysChanged = true; stats.translated++; }
          else { stats.translationRejected++; console.log(`  rejected translation for day ${m.dayNumber}`); }
        }
        // re-check
        const after = analyse(newDays);
        const still = after.guesses.filter((g) => g.language && g.language !== dominant);
        if (still.length > 0 && isPublic) stats.stillMixedPublic++;
      } else if (isPublic) {
        stats.stillMixedPublic++;
      }
    }

    if (APPLY && (metaChanged || daysChanged)) {
      writeFileSync(join(BACKUP_DIR, `${trip.id}.json`), JSON.stringify({ trip_meta: trip.trip_meta, itinerary: trip.itinerary }, null, 2));
      const patch: Record<string, unknown> = {};
      if (metaChanged) patch.trip_meta = meta;
      if (daysChanged) patch.itinerary = wrapped ? { ...(trip.itinerary as object), days: newDays } : newDays;
      const { error } = await supabase.from("trips").update(patch).eq("id", trip.id);
      if (error) { console.error(`  update failed for ${trip.id}: ${error.message}`); continue; }
      if (metaChanged) stats.stamped++;
    }
  }

  console.log("\nlocale by content:", Object.fromEntries(byLocale));
  console.log(stats);
  if (APPLY) console.log(`backups in ${BACKUP_DIR}`);
  console.log(`mixed public trips ${APPLY ? "after" : "now"}: ${stats.stillMixedPublic}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
