// What a trip request may hold. The server refuses more (validateTripParams
// in ./request-validation.ts), and the wizard stops the planner before it, so
// both read these. No imports: the wizard's bundle takes this file as it is.

/** The longest trip planned for one destination, in days. */
export const MAX_TRIP_DAYS = 14;
/**
 * The longest trip across several cities, in days. Each city is planned on
 * its own, so the whole trip may run longer than one destination's.
 */
export const MAX_TRIP_DAYS_MULTI = 21;

/** The most nights one city of a multi-city route may have. */
export const ROUTE_STOP_NIGHTS_MAX = 10;

/** A destination's name, in characters. */
export const DESTINATION_MIN_LENGTH = 2;
export const DESTINATION_MAX_LENGTH = 100;
/**
 * What a destination's name may be made of: letters, spaces, hyphens,
 * commas, dots, parentheses, apostrophes, &, / and digits.
 */
export const DESTINATION_ALLOWLIST = /^[\p{L}\p{M}\s\-,.'()&/0-9]+$/u;

/** The traveller's own words for the plan, in characters. */
export const REQUIREMENTS_MAX = 500;

/** Undated must-dos: at most this many, each at most this long in characters. */
export const MUST_DOS_MAX = 10;
export const MUST_DO_MAX_LENGTH = 80;

/** The most vibes a trip may have. */
export const VIBES_MAX = 3;
