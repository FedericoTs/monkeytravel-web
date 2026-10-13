import { requiredN, twoProportionP, verdict, wilson, type Rate, type Verdict } from "@/lib/analytics/experiment-stats";

/**
 * The crew-first test's decision rule, fixed before the data arrives.
 *
 * Primary: the share rate, sessions that sent a link per session that saw a
 * result. Guardrail: the save rate. crew_first is kept only if it shares more
 * without saving significantly less; a significantly lower save rate stops it.
 */

export interface ArmCounts {
  sessions: number;
  shared: number;
  saved: number;
}

export interface Comparison {
  control: Rate;
  crewFirst: Rate;
  p: number;
  verdict: Verdict;
}

export type Decision = "keep_crew_first" | "keep_control" | "keep_running";

export interface Review {
  share: Comparison;
  save: Comparison;
  decision: Decision;
  reason: string;
}

/** The smallest share-rate lift worth acting on, in absolute points. */
export const SHARE_LIFT_OF_INTEREST = 0.05;

/** No conclusion either way until each arm has this many sessions. */
export const MIN_SESSIONS_PER_ARM = 100;

function compare(control: { s: number; n: number }, crew: { s: number; n: number }): Comparison {
  const c = wilson(control.s, control.n);
  const t = wilson(crew.s, crew.n);
  const p = twoProportionP(crew.s, crew.n, control.s, control.n);
  return { control: c, crewFirst: t, p, verdict: verdict(c, t, p) };
}

export function reviewCrewFirst(control: ArmCounts, crewFirst: ArmCounts): Review {
  const share = compare({ s: control.shared, n: control.sessions }, { s: crewFirst.shared, n: crewFirst.sessions });
  const save = compare({ s: control.saved, n: control.sessions }, { s: crewFirst.saved, n: crewFirst.sessions });

  if (Math.min(control.sessions, crewFirst.sessions) < MIN_SESSIONS_PER_ARM) {
    return { share, save, decision: "keep_running", reason: `fewer than ${MIN_SESSIONS_PER_ARM} sessions in an arm` };
  }
  if (save.verdict === "worse") {
    return { share, save, decision: "keep_control", reason: "crew_first saves significantly less (guardrail)" };
  }
  if (share.verdict === "better") {
    return { share, save, decision: "keep_crew_first", reason: "crew_first shares significantly more, and saves no less" };
  }
  if (share.verdict === "worse") {
    return { share, save, decision: "keep_control", reason: "crew_first shares significantly less" };
  }
  // A share rate of 0 would make any sample "enough"; the floor keeps the bar real.
  const needed = Math.max(MIN_SESSIONS_PER_ARM, requiredN(Math.max(share.control.point, 0.05), SHARE_LIFT_OF_INTEREST));
  if (Math.min(control.sessions, crewFirst.sessions) >= needed) {
    return {
      share,
      save,
      decision: "keep_control",
      reason: `no share lift of ${Math.round(SHARE_LIFT_OF_INTEREST * 100)} points after ${needed}+ sessions per arm`,
    };
  }
  return { share, save, decision: "keep_running", reason: `inconclusive; about ${needed} sessions per arm are needed` };
}
