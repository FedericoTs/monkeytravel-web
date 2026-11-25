/** @vitest-environment node */
/**
 * What a link filled in (days, month, budget, vibes, must-dos) is sent to PostHog once, when the planner opens. PostHog
 * loads only when the browser is idle, after that: the event waits for it (onPostHogReady) instead of going to an SDK
 * that isn't there yet and being dropped, and for the page to be seen (whenSeen: a tab the browser restores in the
 * background is no visit). Asserted against the source: the planner is too big to render for one event.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8").replace(/\r/g, "");

describe("the link's prefill event", () => {
  it("waits for PostHog to load, and for the page to be seen, before it is sent", () => {
    expect(SRC).toMatch(/return whenSeen\(\(\) => onPostHogReady\(\(ph\) => ph\.capture\("wizard_prefilled_from_article", prefilled\)\)\);/);
    expect(SRC).not.toContain('posthog?.capture("wizard_prefilled_from_article"');
  });
});
