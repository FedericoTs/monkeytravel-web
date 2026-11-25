import type { Experiment } from "./registry";

/**
 * Which arm of an experiment this browser sees. Drawn once and kept in the browser, so every visit shows the same
 * arm, and counted only when it was drawn at random and kept: a link's choice (?exp_<key>=<arm>, kept in that
 * browser), a switch (off: the control; an arm's name: that arm) or a date before the start shows an arm without
 * counting it.
 */
export interface Assignment<A extends string = string> {
  arm: A;
  /** Drawn at random and kept: the visitor counts in the experiment. */
  counted: boolean;
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** Where a browser keeps a link's choice, and its draw. */
export const chosenKey = (key: string) => `mt_exp_${key}_chosen`;
export const drawnKey = (key: string) => `mt_exp_${key}_arm`;

export function assignArm<E extends Experiment>(
  experiment: E,
  input: {
    /** The link's ?exp_<key>= value. */
    asked: string | null | undefined;
    store: Store | null;
    now: number;
    random: () => number;
    /** The experiment's switch: "off", or an arm to show everyone. */
    pin?: string;
  },
): Assignment<E["arms"][number]> {
  type Arm = E["arms"][number];
  const isArm = (value: unknown): value is Arm => typeof value === "string" && (experiment.arms as readonly string[]).includes(value);
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
  const control = experiment.arms[0] as Arm;

  if (isArm(input.asked)) {
    write(chosenKey(experiment.key), input.asked);
    return { arm: input.asked, counted: false };
  }
  const chosen = read(chosenKey(experiment.key));
  if (isArm(chosen)) return { arm: chosen, counted: false };
  if (input.pin === "off") return { arm: control, counted: false };
  if (isArm(input.pin)) return { arm: input.pin, counted: false };
  if (input.now < experiment.starts) return { arm: control, counted: false };

  const drawn = read(drawnKey(experiment.key));
  if (isArm(drawn)) return { arm: drawn, counted: true };
  const arms = experiment.arms as readonly Arm[];
  const arm = arms[Math.min(arms.length - 1, Math.floor(input.random() * arms.length))];
  // Only a browser that keeps its draw counts: it sees the same arm on every visit.
  return { arm, counted: write(drawnKey(experiment.key), arm) };
}
