import { test, expect } from "@playwright/test";

/**
 * Pillar landing pages — the SEO-focused entry points. They rarely get
 * touched so regressions linger. Smoke test: each one renders, has a
 * non-empty h1, no raw i18n keys leak through, no console errors.
 */

const PILLAR_PATHS = [
  "/ai-itinerary-generator",
  "/weekend-trip-planner",
  "/family-trip-planner",
  "/budget-trip-planner",
  "/solo-trip-planner",
  "/group-trip-planner",
  "/free-ai-trip-planner",
] as const;

/** Catches "trips.wizard.X" / "common.Y.Z" raw-key leaks. */
const RAW_KEY_RE = /\b(trips|tools|common|destinations|blog)\.[a-z][\w.]*\b/i;

test.describe("pillar landing pages @prod", () => {
  for (const path of PILLAR_PATHS) {
    test(`${path} renders without raw keys or console errors`, async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          // Filter out the noise: failed third-party trackers, Sentry,
          // CSP report-only violations — none of those are our bugs.
          if (
            !/sentry|posthog|google-analytics|gtm|tagmanager|hotjar|csp/i.test(
              text
            )
          ) {
            consoleErrors.push(text);
          }
        }
      });

      const res = await page.goto(path);
      expect(res?.status(), `${path} should return 200`).toBe(200);

      // h1 exists + non-empty (rules out broken layout where h1 is rendered
      // by a child component that didn't load).
      const h1Text = await page.locator("h1").first().textContent();
      expect(h1Text?.trim() || "", `${path} h1 must not be empty`).not.toBe(
        ""
      );

      // Raw-key check — full visible body text.
      const bodyText = await page.locator("body").innerText();
      const keyMatch = bodyText.match(RAW_KEY_RE);
      expect(
        keyMatch,
        `${path}: raw i18n key leaked to UI: ${keyMatch?.[0]}`
      ).toBeNull();

      expect(
        consoleErrors,
        `${path}: console errors detected:\n${consoleErrors.join("\n")}`
      ).toEqual([]);
    });
  }
});
