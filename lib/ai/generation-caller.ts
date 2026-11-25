import type { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { errors } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { checkApiAccess, type ApiAccessResult } from "@/lib/api-gateway";
import { checkAnonymousRateLimit } from "@/lib/anonymous/rate-limit";
import { withinAnonDailyLimit } from "@/lib/ai/anon-daily-limit";
import { createClient } from "@/lib/supabase/server";
import { loadUserContext } from "@/lib/ai/user-context";
import { requestLocale, type SupportedLanguage } from "@/lib/ai/language";
import { withTripDiet } from "@/lib/trips/diet";
import { daylightFor, readCoordinates } from "@/lib/ai/daylight";
import { whatsOn } from "@/lib/ai/whats-on";
import { cityPointsFor } from "@/lib/ai/city-points";
import { cleanStayName } from "@/lib/trips/stay";
import type { TripCreationParams, UserProfilePreferences } from "@/types";
import { childAgeBands, isArrival, isChosenTripIntent, isDeparture, isOccasion } from "@/lib/wizard/answers";
import { isIsoDate } from "@/lib/trips/anonymous-share";
import { addIsoDays, tripSpanDays } from "@/lib/dates/iso-date";

// Anti-abuse: cap ANONYMOUS generations per IP/day (defense-in-depth on top of
// the per-cookie limit, which a bot can reset by clearing cookies). Authenticated
// users are never limited. Deliberately HIGH (40/IP/day) so it can't touch real
// users or shared/carrier NAT at current scale — only a scripted attacker doing
// hundreds/day. The stream and non-stream routes count against this one bucket.
const anonGenIpLimiter = createRateLimiter("anon-generate", 40, 24 * 60 * 60 * 1000);

/** Who asked for a plan, and with what. */
export interface GenerationCaller {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User | null;
  isAnonymous: boolean;
  body: Record<string, unknown>;
  /** The AI kill-switch's answer: each route checks it once the trip is valid. */
  access: ApiAccessResult;
  /** The profile's preferences, with the diet this request asked for. */
  profilePreferences: UserProfilePreferences;
  userLanguage: SupportedLanguage;
}

/**
 * Who is asking for a plan, and the request's body. Anonymous generation is
 * allowed: visitors generate without signing up and the auth wall fires at
 * Save, because a signup wall before the result loses most generators. An
 * anonymous visitor is capped per cookie (lib/anonymous/rate-limit) and per
 * IP. A visitor over either cap, or a body that is not a JSON object, gets
 * `refused`: the response to send. `generationId` is the wizard's id for this
 * try: a try already counted under it is not refused by the cookie cap.
 */
export async function readGenerationCaller(
  request: NextRequest,
  generationId?: string | null
): Promise<{ refused: Response } | GenerationCaller> {
  const supabase = await createClient();
  const {
    data: { user: maybeUser },
  } = await supabase.auth.getUser();
  const user: User | null = maybeUser ?? null;
  const isAnonymous = user === null;

  // The reads are independent, so they run in parallel; their results are
  // checked below in priority order: anon cookie limit → per-IP limit → body.
  // A rejection from request.json resolves to null and becomes a 400.
  const [anonLimit, body, userContext, access, anonIpLimit, anonDaily] = await Promise.all([
    isAnonymous ? checkAnonymousRateLimit(generationId ?? undefined) : Promise.resolve(null),
    request.json().catch(() => null as Record<string, unknown> | null),
    loadUserContext(supabase, user?.id ?? null),
    checkApiAccess("gemini"),
    // Fail-OPEN: a limiter/KV error must NEVER block a real generation, so
    // swallow errors into an allow.
    isAnonymous
      ? anonGenIpLimiter.check(request).catch(() => ({ allowed: true, remaining: 0 }))
      : Promise.resolve(null),
    isAnonymous ? withinAnonDailyLimit() : Promise.resolve(true),
  ]);

  if (isAnonymous && anonLimit && !anonLimit.allowed) {
    return {
      refused: errors.rateLimit(anonLimit.message || "Free trip limit reached. Sign up to keep generating.", {
        usage: anonLimit,
        signupUrl: "/auth/signup",
      }),
    };
  }

  // Per-IP backstop for cookie-resetting bots (the cookie cap above is
  // trivially reset). Only trips under real abuse at 40/IP/day.
  if (isAnonymous && anonIpLimit && !anonIpLimit.allowed) {
    return {
      refused: errors.rateLimit(
        "You've reached today's free-trip limit for your network. Sign up to keep generating — it's free.",
        { signupUrl: "/auth/signup" }
      ),
    };
  }

  if (!anonDaily) {
    return {
      refused: errors.rateLimit("We've reached today's limit for free plans. Sign up to keep going — it's free.", {
        signupUrl: "/auth/signup",
      }),
    };
  }

  if (!body || typeof body !== "object") {
    return { refused: errors.badRequest("Body must be valid JSON") };
  }

  return {
    supabase,
    user,
    isAnonymous,
    body,
    access,
    profilePreferences: withTripDiet(userContext.profilePreferences, body.dietary),
    // The page's own locale wins: next-intl writes NEXT_LOCALE only when it
    // differs from the browser language, so the cookie is usually absent.
    userLanguage: requestLocale(body.locale) ?? userContext.userLanguage,
  };
}

/**
 * The trip a generation request asks for. The casts are loose on purpose:
 * validateTripParams rejects unknown values and enforces the limits, and is
 * the security boundary.
 */
export function tripParamsFromBody(
  body: Record<string, unknown>,
  profilePreferences: UserProfilePreferences
): TripCreationParams {
  return {
    destination: body.destination as string,
    startDate: body.startDate as string,
    endDate: body.endDate as string,
    budgetTier: (body.budgetTier as TripCreationParams["budgetTier"]) || "balanced",
    pace: (body.pace as TripCreationParams["pace"]) || "moderate",
    vibes: (body.vibes as TripCreationParams["vibes"]) || [],
    seasonalContext: body.seasonalContext as TripCreationParams["seasonalContext"],
    interests: (body.interests as string[]) || [],
    requirements: body.requirements as TripCreationParams["requirements"],
    // Must-do wishlist, trimmed and without empties.
    ...(Array.isArray(body.mustDos) && body.mustDos.length > 0
      ? {
          mustDos: (body.mustDos as unknown[])
            .map((m) => String(m ?? "").trim())
            .filter(Boolean)
            .slice(0, 10),
        }
      : {}),
    // Whitelisted, so untrusted strings can't flow into the AI system prompt.
    travelStyle: body.travelStyle === "backpacker" ? "backpacker" : "classic",
    ...(isChosenTripIntent(body.tripIntent) ? { tripIntent: body.tripIntent } : {}),
    ...withChildrenAges(body),
    ...withOccasion(body),
    ...withTravelDays(body),
    ...withDaylight(body),
    ...withWhatsOn(body),
    ...withStay(body),
    profilePreferences,
  };
}

/**
 * Where they're staying, as one bounded line of their words, and where it is
 * when it was picked from a list. A trip through several cities leaves it
 * out: the stay is in one of them.
 */
function withStay(body: Record<string, unknown>): Pick<TripCreationParams, "stay"> {
  const name = cleanStayName(body.stay);
  const severalCities = Array.isArray(body.destinations) && body.destinations.length > 1;
  if (!name || severalCities) return {};
  const coordinates = readCoordinates(body.stayCoords);
  return { stay: { name, ...(coordinates ? { coordinates } : {}) } };
}

/** The children's ages, on a family's trip only, as the fixed bands (never the request's own words). */
function withChildrenAges(body: Record<string, unknown>): Pick<TripCreationParams, "childrenAges"> {
  const bands = body.tripIntent === "family" ? childAgeBands(body.childrenAges) : [];
  return bands.length > 0 ? { childrenAges: bands } : {};
}

/**
 * A special trip the planner offers, with the day of its evening: the one asked for when it is on the trip, or else
 * the day before the last (the last, on a trip of one or two days). Fixed here, so each city of a route can tell
 * whether the evening is its own.
 */
function withOccasion(body: Record<string, unknown>): Pick<TripCreationParams, "occasion"> {
  const { occasion, occasionDate, startDate, endDate } = body;
  if (!isOccasion(occasion) || !isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) return {};
  const onTrip = isIsoDate(occasionDate) && occasionDate >= startDate && occasionDate <= endDate;
  const date = onTrip ? occasionDate : tripSpanDays(startDate, endDate) >= 3 ? (addIsoDays(endDate, -1) ?? endDate) : endDate;
  return { occasion: { kind: occasion, date } };
}

/**
 * When they arrive and leave, as the planner's fixed answers on the trip's first and last dates, fixed here before a
 * route is split into its cities: never the request's own words.
 */
function withTravelDays(body: Record<string, unknown>): Pick<TripCreationParams, "arrival" | "departure"> {
  const { arrival, departure, startDate, endDate } = body;
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) return {};
  return {
    ...(isArrival(arrival) ? { arrival: { when: arrival, date: startDate } } : {}),
    ...(isDeparture(departure) ? { departure: { when: departure, date: endDate } } : {}),
  };
}

/** The sun at the destination, when the planner sent where it is. */
function withDaylight(body: Record<string, unknown>): Pick<TripCreationParams, "daylight"> {
  const daylight = daylightFor(readCoordinates(body.destinationCoords), body.startDate, body.endDate);
  return daylight ? { daylight } : {};
}

/** What is on at the destination on the trip's dates, when the planner sent where it is. */
function withWhatsOn(body: Record<string, unknown>): Pick<TripCreationParams, "whatsOn"> {
  const on = whatsOn(readCoordinates(body.destinationCoords), body.startDate, body.endDate);
  return on.length > 0 ? { whatsOn: on } : {};
}

/**
 * A one-place trip typed and not picked sends no point, so it had no sunrise
 * and sunset and wasn't told what's on. Its point comes from the cities table
 * a route's cities already use (lib/ai/city-points.ts), for a bare name only:
 * "Paris, Texas" typed by hand would find Paris, France.
 */
export async function withTypedPlace(params: TripCreationParams, body: Record<string, unknown>): Promise<TripCreationParams> {
  if (readCoordinates(body.destinationCoords)) return params;
  if (Array.isArray(body.destinations) && body.destinations.length > 1) return params;
  const name = typeof params.destination === "string" ? params.destination.trim() : "";
  if (!name || name.includes(",")) return params;
  const [point] = await cityPointsFor([name]);
  if (!point) return params;
  const daylight = daylightFor(point, params.startDate, params.endDate);
  const on = whatsOn(point, params.startDate, params.endDate);
  return { ...params, ...(daylight ? { daylight } : {}), ...(on.length > 0 ? { whatsOn: on } : {}) };
}
