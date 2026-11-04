import { isTripVibe, type TripCreationParams } from "@/types";
import { tripSpanDays } from "@/lib/dates/iso-date";
import {
  DESTINATION_ALLOWLIST,
  DESTINATION_MAX_LENGTH,
  DESTINATION_MIN_LENGTH,
  MAX_TRIP_DAYS,
  MUST_DOS_MAX,
  MUST_DO_MAX_LENGTH,
  REQUIREMENTS_MAX,
  VIBES_MAX,
} from "./request-limits";

// Input validation — defense-in-depth against prompt injection
const DANGEROUS_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /disregard\s+(all\s+)?prior/gi,
  /you\s+are\s+now/gi,
  /pretend\s+to\s+be/gi,
  /system\s+prompt/gi,
  /\[INST\]/gi,
  /<<SYS>>/gi,
  /new\s+persona/gi,
  /override\s+(your|the|all)/gi,
  /forget\s+everything/gi,
  /do\s+not\s+follow/gi,
  /bypass\s+(the\s+)?filter/gi,
  /act\s+as\s+(a|an|if)/gi,
  /roleplay\s+as/gi,
  /jailbreak/gi,
  /DAN\s+mode/gi,
  /developer\s+mode/gi,
  /respond\s+as\s+if/gi,
  /reveal\s+(your|the)\s+(system|instructions|prompt)/gi,
  /what\s+are\s+your\s+instructions/gi,
];

const BLACKLIST = [
  "<script",
  "</script",
  "javascript:",
  "eval(",
  "onerror=",
  "onload=",
];

export function validateTripParams(
  params: TripCreationParams,
  // maxDays: multi-city trips generate per-city in parallel, so the whole-trip
  // ceiling can safely exceed the single-city generation limit. The
  // /api/ai/generate route passes MAX_TRIP_DAYS_MULTI when destinations[] has
  // more than one leg.
  opts?: { maxDays?: number }
): { valid: boolean; error?: string } {
  const maxDays = opts?.maxDays ?? MAX_TRIP_DAYS;
  // Destination validation
  if (!params.destination || params.destination.length < DESTINATION_MIN_LENGTH) {
    return { valid: false, error: "Destination is required" };
  }

  if (params.destination.length > DESTINATION_MAX_LENGTH) {
    return { valid: false, error: "Destination name too long" };
  }

  // Whitelist: destination must contain only geographic-name characters
  if (!DESTINATION_ALLOWLIST.test(params.destination)) {
    return { valid: false, error: "Destination contains invalid characters" };
  }

  // Check for blacklisted content in destination
  const destLower = params.destination.toLowerCase();
  for (const blocked of BLACKLIST) {
    if (destLower.includes(blocked.toLowerCase())) {
      return { valid: false, error: "Invalid characters in destination" };
    }
  }

  // Check for prompt injection in destination
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(params.destination)) {
      return { valid: false, error: "Invalid input detected" };
    }
  }

  // Validate requirements field if present
  if (params.requirements) {
    if (params.requirements.length > REQUIREMENTS_MAX) {
      return { valid: false, error: `Requirements text too long (max ${REQUIREMENTS_MAX} characters)` };
    }
    for (const blocked of BLACKLIST) {
      if (params.requirements.toLowerCase().includes(blocked.toLowerCase())) {
        return { valid: false, error: "Invalid characters in requirements" };
      }
    }
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(params.requirements)) {
        return { valid: false, error: "Invalid input detected" };
      }
    }
  }

  // Validate must-dos if present — same injection defenses as requirements,
  // plus shape limits (the wizard enforces these too; this is the server
  // boundary for direct API callers).
  if (params.mustDos !== undefined) {
    if (!Array.isArray(params.mustDos) || params.mustDos.length > MUST_DOS_MAX) {
      return { valid: false, error: `Must-dos must be a list of at most ${MUST_DOS_MAX} items` };
    }
    for (const item of params.mustDos) {
      if (typeof item !== "string" || item.trim().length === 0 || item.length > MUST_DO_MAX_LENGTH) {
        return { valid: false, error: `Each must-do must be 1-${MUST_DO_MAX_LENGTH} characters` };
      }
      for (const blocked of BLACKLIST) {
        if (item.toLowerCase().includes(blocked.toLowerCase())) {
          return { valid: false, error: "Invalid characters in must-dos" };
        }
      }
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(item)) {
          return { valid: false, error: "Invalid input detected" };
        }
      }
    }
  }

  // Date validation
  //
  // Strict YYYY-MM-DD shape check FIRST. <input type="date"> accepts years up
  // to 275760; the lenient legacy parser takes `new Date("20220-08-11")`, but
  // addDaysISO() downstream appends "T00:00:00Z", and the STRICT ISO parser
  // rejects a 5-digit year mid-generation. Anchoring the format here returns a
  // clean 400 for every caller instead.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO_DATE.test(params.startDate ?? "") || !ISO_DATE.test(params.endDate ?? "")) {
    return { valid: false, error: "Invalid date format" };
  }

  const start = new Date(`${params.startDate}T00:00:00Z`);
  const end = new Date(`${params.endDate}T00:00:00Z`);
  // The traveller picks dates in their own timezone, so "today" can be a
  // calendar day behind UTC (the Americas in the evening). Allow one day of
  // slack so their today is never rejected as past.
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCDate(now.getUTCDate() - 1);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: "Invalid date format" };
  }

  if (start < now) {
    return { valid: false, error: "Start date cannot be in the past" };
  }

  if (end <= start) {
    return { valid: false, error: "End date must be after start date" };
  }

  const days = tripSpanDays(params.startDate, params.endDate);
  if (days > maxDays) {
    return { valid: false, error: `Maximum trip duration is ${maxDays} days` };
  }

  // Budget tier validation
  const validTiers = ["budget", "balanced", "premium"];
  if (!validTiers.includes(params.budgetTier)) {
    return { valid: false, error: "Invalid budget tier" };
  }

  // Interests validation
  if (params.interests && params.interests.length > 10) {
    return { valid: false, error: "Maximum 10 interests allowed" };
  }

  // Vibes validation
  if (params.vibes) {
    if (params.vibes.length === 0) {
      return { valid: false, error: "At least one vibe is required" };
    }
    if (params.vibes.length > VIBES_MAX) {
      return { valid: false, error: `Maximum ${VIBES_MAX} vibes allowed` };
    }
    for (const vibe of params.vibes) {
      if (!isTripVibe(vibe)) {
        return { valid: false, error: `Invalid vibe: ${vibe}` };
      }
    }
  }

  return { valid: true };
}
