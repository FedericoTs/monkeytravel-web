/**
 * The experiments the app runs with its own draw. Each has its arms (the first is today's experience, the control),
 * when the draw starts, and the day by which it must be read and decided: a test fails after that day, so none runs
 * on unread. The draw (assign.ts), the record of which arm a visitor saw (exposure.ts, the experiment_exposures
 * table) and the PostHog property follow the same rules for every experiment. The sky test predates this
 * (result-sky.ts) and ends on its own.
 */
export interface Experiment {
  /** Lower case, digits and underscores: the table checks it. */
  key: string;
  /** The control first. */
  arms: readonly [string, string, ...string[]];
  /** When the draw starts (UTC ms). Before it, everyone sees the control and nothing is counted. */
  starts: number;
  /** YYYY-MM-DD: read and decide it by then. */
  reviewBy: string;
}

/**
 * Step 2 starts with the two styles travellers most often choose for the kind of place and company, never empty,
 * and a tap adds to them ("data"), or as today with the season's suggestions, which a tap replaces ("season").
 */
export const STEP2_DEFAULT = {
  key: "step2_default",
  arms: ["season", "data"],
  starts: Date.UTC(2026, 10, 30),
  reviewBy: "2026-12-22",
} as const satisfies Experiment;

/**
 * What a signed-out planner is told about keeping a plan: as today, the box's sentence naming the two ways in
 * ("words"), or what an account gives on the trip and before it ("benefits"): said at the end of the plan, with a
 * way to save, and in the box in the same space. Counted from the plan on screen, where the arms first differ.
 */
export const SAVE_BOX_BENEFITS = {
  key: "save_box_benefits",
  arms: ["words", "benefits"],
  starts: Date.UTC(2026, 10, 26, 20, 0),
  reviewBy: "2027-01-12",
} as const satisfies Experiment;

/**
 * How a phone reads a plan: as today, a tall card for every stop with its picture, description, address and
 * buttons ("cards"), or the days in a row to jump between and every stop a short row that opens its sheet, with
 * the assistant after the first day ("rows"). Counted from the plan on a phone's screen, where the arms differ.
 */
export const PHONE_PLAN_ROWS = {
  key: "phone_plan_rows",
  arms: ["cards", "rows"],
  starts: Date.UTC(2026, 10, 28, 12, 0),
  reviewBy: "2026-12-19",
} as const satisfies Experiment;

export const EXPERIMENTS: readonly Experiment[] = [STEP2_DEFAULT, SAVE_BOX_BENEFITS, PHONE_PLAN_ROWS];

export function experimentByKey(key: string): Experiment | undefined {
  return EXPERIMENTS.find((experiment) => experiment.key === key);
}
