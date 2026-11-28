/** @vitest-environment node */
/**
 * The sky test ended on 2026-11-28 with the classic plan screen kept. Every
 * browser sees the classic screen, and the property the test registered on a
 * counted browser's PostHog events (result_variant) is cleared, because PostHog
 * keeps such a property in the browser until it is. Asserted against the source:
 * the wizard is too large to render here.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8").replace(/\r\n/g, "\n");
const ROOT = join(__dirname, "../../../../..");

describe("the plan screen after the sky test", () => {
  it("clears the test's PostHog property once PostHog is ready, and registers none", () => {
    expect(SRC).toMatch(/useEffect\(\(\) => \{\n\s*onPostHogReady\(\(posthog\) => posthog\.unregister\("result_variant"\)\);\n\s*\}, \[\]\);/);
    expect(SRC).not.toMatch(/register\(\{\s*result_variant/);
  });

  it("draws one screen for everyone: no draw, no sky", () => {
    expect(SRC).not.toMatch(/skyTest|SkyPlan|result-sky|resultVariant/);
    expect(existsSync(join(ROOT, "components/sky"))).toBe(false);
    expect(existsSync(join(ROOT, "lib/experiments/result-sky.ts"))).toBe(false);
  });
});
