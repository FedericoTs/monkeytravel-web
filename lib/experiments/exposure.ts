import type { Assignment } from "./assign";
import type { Experiment } from "./registry";

/** The PostHog call that sets a property on every later event. */
interface SuperProperties {
  register(properties: Record<string, unknown>): void;
}

export interface ExposureDeps {
  post: (url: string, init: RequestInit) => Promise<unknown>;
  /** Runs the callback once PostHog is loaded, which is only for visitors who accepted analytics. */
  onPostHog: (callback: (posthog: SuperProperties) => void) => void;
}

/**
 * Records that a counted browser saw its arm, once per page and experiment, at the moment the arms first differ for
 * it: a row in experiment_exposures for every visitor (POST /api/experiments/exposure), and the arm as the PostHog
 * property exp_<key> for visitors who accepted analytics. A chosen, switched or not-yet-started arm records nothing.
 */
export function createExposureReporter(deps: ExposureDeps) {
  const sent = new Set<string>();
  return (experiment: Experiment, assignment: Assignment): void => {
    if (!assignment.counted || sent.has(experiment.key)) return;
    sent.add(experiment.key);
    void Promise.resolve()
      .then(() =>
        deps.post("/api/experiments/exposure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ experiment: experiment.key, arm: assignment.arm }),
          keepalive: true,
        }),
      )
      .catch(() => {
        // The visitor's page goes on; a lost row only makes the experiment a little smaller.
      });
    deps.onPostHog((posthog) => posthog.register({ [`exp_${experiment.key}`]: assignment.arm }));
  };
}
