/**
 * The result-screen test for signed-out planners of group trips: today's
 * screen (control) or one that leads with the crew vote (crew_first), 50/50.
 *
 * Assigned in the browser and kept there, because PostHog flags load only
 * after cookie consent, which most visitors never give. The arm a session saw
 * is written to wizard_step_events.result_variant on its `result` row.
 *
 * NEXT_PUBLIC_RESULT_CREW_FIRST=control|crew_first pins every browser (the off
 * switch) and ?result_variant= pins one page (QA); a pinned arm is not
 * recorded, so it never enters the comparison.
 */

export const RESULT_VARIANTS = ["control", "crew_first"] as const;
export type ResultVariant = (typeof RESULT_VARIANTS)[number];

export const RESULT_VARIANT_STORAGE_KEY = "mt_result_variant";

const isVariant = (value: unknown): value is ResultVariant =>
  typeof value === "string" && (RESULT_VARIANTS as readonly string[]).includes(value);

export interface ResultArm {
  variant: ResultVariant;
  /** Drawn at random (now or on an earlier visit): the session counts in the test. */
  inTest: boolean;
}

/** The decision itself, free of the browser so it can be tested. */
export function pickResultVariant(input: {
  pinned?: string | null;
  override?: string | null;
  stored?: string | null;
  random: () => number;
}): ResultArm {
  if (isVariant(input.pinned)) return { variant: input.pinned, inTest: false };
  if (isVariant(input.override)) return { variant: input.override, inTest: false };
  if (isVariant(input.stored)) return { variant: input.stored, inTest: true };
  return { variant: input.random() < 0.5 ? "control" : "crew_first", inTest: true };
}

// Kept for the life of the page, so a browser that refuses storage still sees
// one arm from the result it was assigned on to the row that records it.
let thisPage: ResultArm | null = null;

/** This browser's arm, drawn on first use and stored for later visits. */
export function resultCrewFirstArm(): ResultArm {
  if (thisPage) return thisPage;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(RESULT_VARIANT_STORAGE_KEY);
  } catch {
    // Storage blocked: the arm lasts for this page only.
  }
  let override: string | null = null;
  try {
    override = new URLSearchParams(window.location.search).get("result_variant");
  } catch {
    override = null;
  }
  const arm = pickResultVariant({
    pinned: process.env.NEXT_PUBLIC_RESULT_CREW_FIRST,
    override,
    stored,
    random: Math.random,
  });
  if (arm.inTest && stored !== arm.variant) {
    try {
      window.localStorage.setItem(RESULT_VARIANT_STORAGE_KEY, arm.variant);
    } catch {
      // As above.
    }
  }
  thisPage = arm;
  return arm;
}

/** For tests: forget this page's arm. */
export function resetResultArmForTests(): void {
  thisPage = null;
}
