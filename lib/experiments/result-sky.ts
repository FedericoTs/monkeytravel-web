/**
 * The sky test: from SKY_TEST_STARTS, half the browsers that reach a plan see
 * it drawn as a sky (components/sky) and half the classic screen. The arm is
 * drawn once, kept in the browser so every plan shows the same screen, and
 * written on the session's `result` row (wizard_step_events.result_variant),
 * so saves and shares can be compared by arm.
 *
 * A link chooses instead: ?result_variant=sky or =classic, kept in that
 * browser. A chosen arm is shown but never written, so every written row was
 * drawn at random. NEXT_PUBLIC_RESULT_SKY=off stops the draw (the off switch;
 * links still work) and =on shows everyone the sky, also without writing.
 */

export type SkyArm = "sky" | "classic";

export interface SkyAssignment {
  arm: SkyArm;
  /** Drawn at random and kept: the session counts in the test. */
  counted: boolean;
}

/** When the draw starts. Before it, only a link shows the sky. */
export const SKY_TEST_STARTS = Date.UTC(2026, 10, 14);

/** A link's choice. "1" is what the first links stored, and means the sky. */
const CHOSEN = "mt_result_sky";
/** The draw. */
const DRAWN = "mt_result_sky_arm";

type Store = Pick<Storage, "getItem" | "setItem">;

const isArm = (value: unknown): value is SkyArm => value === "sky" || value === "classic";

export function assignSky(input: {
  asked: string | null | undefined;
  store: Store | null;
  now: number;
  random: () => number;
  pin?: string;
}): SkyAssignment {
  const read = (key: string) => {
    try {
      return input.store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string) => {
    if (!input.store) return false;
    try {
      input.store.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  if (isArm(input.asked)) {
    write(CHOSEN, input.asked);
    return { arm: input.asked, counted: false };
  }
  const chosen = read(CHOSEN);
  if (chosen === "1" || isArm(chosen)) return { arm: chosen === "classic" ? "classic" : "sky", counted: false };
  if (input.pin === "on") return { arm: "sky", counted: false };
  if (input.pin === "off" || input.now < SKY_TEST_STARTS) return { arm: "classic", counted: false };

  const drawn = read(DRAWN);
  if (isArm(drawn)) return { arm: drawn, counted: true };
  const arm: SkyArm = input.random() < 0.5 ? "sky" : "classic";
  // Only a browser that keeps its draw counts: it sees one screen on every plan.
  return { arm, counted: write(DRAWN, arm) };
}
