/**
 * A plan kept for a signed-out planner (supabase/migrations/…_kept_plans.sql):
 * what the planner needs to put it back on screen, on any device, through the
 * plan's private link (/p/<token>).
 *
 * The plan is client JSON headed for a jsonb column and back into the planner,
 * so it is checked here on the way in: the shape the result view needs, the
 * sizes the wizard allows, and only https links.
 */

import type { GeneratedItinerary, TripVibe } from "@/types";
import { isIsoDate, MAX_TRIP_DAYS } from "@/lib/trips/anonymous-share";

const PACES = ["relaxed", "moderate", "active"] as const;
const BUDGET_TIERS = ["budget", "balanced", "premium"] as const;
const VIBES: readonly TripVibe[] = [
  "adventure", "cultural", "foodie", "wellness", "romantic", "urban",
  "nature", "offbeat", "wonderland", "movie-magic", "fairytale", "retro",
];

export interface KeptPlan {
  destination: string;
  startDate: string;
  endDate: string;
  itinerary: GeneratedItinerary;
  pace?: (typeof PACES)[number];
  vibes?: TripVibe[];
  budgetTier?: (typeof BUDGET_TIERS)[number];
  travelStyle?: "classic" | "backpacker";
  tripIntent?: "solo" | "group";
  flexibleDates?: boolean;
  mustDos?: string[];
}

function oneOf<T extends string>(options: readonly T[], v: unknown): T | undefined {
  return options.find((o) => o === v);
}

/** Days a plan lives after it was kept or last opened. */
export const KEPT_PLAN_DAYS = 30;

/** Raw body cap for keeping or changing a plan. */
export const MAX_KEPT_PLAN_BYTES = 256 * 1024;

/** 16 random bytes, base64url. */
export const KEPT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isKeptToken(v: unknown): v is string {
  return typeof v === "string" && KEPT_TOKEN_PATTERN.test(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** An https URL, or a path on this site (the photo proxies); anything else is dropped. */
function safeLink(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    return new URL(v).protocol === "https:" ? v : undefined;
  } catch {
    return undefined;
  }
}

function strings(v: unknown, max: number, length: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .slice(0, max)
    .map((s) => s.slice(0, length));
}

const ACTIVITY_LINKS = ["image_url", "booking_url", "official_website"] as const;

/** Links on activities and in booking_links: safe ones only. */
function withSafeLinks(itinerary: Record<string, unknown>): Record<string, unknown> {
  const days = (itinerary.days as unknown[]).map((day) => {
    const d = day as Record<string, unknown>;
    return {
      ...d,
      activities: (d.activities as unknown[]).map((activity) => {
        if (!isRecord(activity)) return activity;
        const safe: Record<string, unknown> = { ...activity };
        for (const field of ACTIVITY_LINKS) {
          const link = safeLink(activity[field]);
          if (link) safe[field] = link;
          else delete safe[field];
        }
        return safe;
      }),
    };
  });
  const links = itinerary.booking_links;
  const safeList = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((l) => isRecord(l) && safeLink(l.url)?.startsWith("https:")).slice(0, 10)
      : [];
  return {
    ...itinerary,
    days,
    ...(isRecord(links) ? { booking_links: { flights: safeList(links.flights), hotels: safeList(links.hotels) } } : {}),
  };
}

/** The plan in `input`, or null when it is not one the planner could show. */
export function parseKeptPlan(input: unknown): KeptPlan | null {
  if (!isRecord(input)) return null;
  const destination = typeof input.destination === "string" ? input.destination.trim().slice(0, 200) : "";
  if (!destination) return null;
  const { startDate, endDate } = input;
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) return null;

  const itinerary = input.itinerary;
  if (!isRecord(itinerary) || !isRecord(itinerary.destination) || typeof itinerary.destination.name !== "string") return null;
  if (!isRecord(itinerary.trip_summary)) return null;
  const days = itinerary.days;
  if (!Array.isArray(days) || days.length === 0 || days.length > MAX_TRIP_DAYS) return null;
  if (!days.every((day) => isRecord(day) && Array.isArray(day.activities))) return null;

  const pace = oneOf(PACES, input.pace);
  const budgetTier = oneOf(BUDGET_TIERS, input.budgetTier);
  const vibes = Array.isArray(input.vibes)
    ? input.vibes.map((v) => oneOf(VIBES, v)).filter((v): v is TripVibe => !!v).slice(0, 6)
    : undefined;
  const mustDos = strings(input.mustDos, 10, 120);
  return {
    destination,
    startDate,
    endDate,
    itinerary: withSafeLinks(itinerary) as unknown as GeneratedItinerary,
    ...(pace ? { pace } : {}),
    ...(vibes ? { vibes } : {}),
    ...(budgetTier ? { budgetTier } : {}),
    ...(input.travelStyle === "backpacker" || input.travelStyle === "classic" ? { travelStyle: input.travelStyle } : {}),
    ...(input.tripIntent === "solo" || input.tripIntent === "group" ? { tripIntent: input.tripIntent } : {}),
    ...(input.flexibleDates === true ? { flexibleDates: true } : {}),
    ...(mustDos?.length ? { mustDos } : {}),
  };
}
