import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config.
 *
 * Two test modes:
 *   - `BASE_URL=https://monkeytravel.app npx playwright test --grep @prod`
 *     runs the prod-smoke suite against the live deployment. Cheap, fast,
 *     no local server needed — use this to verify a deploy worked.
 *   - `npx playwright test` (no env) defaults to localhost:3000 and
 *     skips @prod tests. Use this for full-coverage runs that include
 *     mutating flows.
 *
 * CI: run the @prod subset after every successful Vercel deploy
 * (see scripts/verify-deploy.sh). The full suite belongs in a separate
 * job that spins up a Next dev server.
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const IS_PROD_TARGET = BASE_URL.startsWith("https://");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000, // Gemini generations can take 30-40s
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Use a slightly modern user-agent so middleware doesn't 403 us as
    // a scraper. The bot-blocker pattern list doesn't match generic
    // headless Chromium, but the default UA has "HeadlessChrome" in it
    // which some servers fingerprint.
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Mobile viewport — important since 50%+ of traffic is mobile.
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  // Only spin up a local dev server when targeting localhost.
  webServer: IS_PROD_TARGET
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
