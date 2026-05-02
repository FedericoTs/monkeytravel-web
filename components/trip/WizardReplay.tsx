"use client";

import { useEffect } from "react";

/**
 * Forces a Sentry session replay to start whenever the user lands on /trips/new
 * (assuming sessionRecording consent is granted — gated upstream in
 * instrumentation-client.ts).
 *
 * The wizard funnel currently drops 96% of users between step 1 and step 2 with
 * no actionable signal. Capturing 100% of consented wizard sessions gives us
 * the rage-clicks, dead-clicks, and form errors needed to find the real cause.
 *
 * Outside the wizard, replay still captures only on errors
 * (replaysOnErrorSampleRate: 1.0), keeping replay storage bounded.
 */
export default function WizardReplay() {
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;

    (async () => {
      try {
        const Sentry = await import("@sentry/nextjs");
        if (cancelled) return;

        Sentry.setTag("wizard_replay", "true");
        Sentry.setContext("wizard_replay", { route: "/trips/new" });

        const client = Sentry.getClient?.();
        if (!client) return;
        const replay = client.getIntegrationByName?.("Replay") as
          | { start: () => void; stop: () => Promise<void> | void }
          | undefined;
        if (!replay) return;

        try {
          replay.start();
        } catch {
          // Already started (e.g. error replay sampled this session) — fine.
          return;
        }
        stop = () => {
          try {
            replay.stop();
          } catch {
            /* noop */
          }
        };
      } catch {
        /* Sentry may not be loaded yet (consent gate, idle-callback) — fine. */
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return null;
}
