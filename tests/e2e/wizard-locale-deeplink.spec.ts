import { test, expect } from "@playwright/test";

/**
 * `?destination=<city>` deeplink pre-fill on the wizard.
 *
 * Worked on /trips/new but BROKE on /it/trips/new (2026-05-25 live
 * test — Milan deeplink left the field empty on the Italian wizard).
 * The fix lives in chip #4 (DateRangePicker localization PR); these
 * tests will fail on the IT/ES cases until that ships, then turn green.
 */

const CASES = [
  { path: "/trips/new?destination=Trieste", expected: "Trieste" },
  { path: "/it/trips/new?destination=Trieste", expected: "Trieste" },
  { path: "/es/trips/new?destination=Madrid", expected: "Madrid" },
  { path: "/it/trips/new?destination=Milano", expected: "Milano" },
] as const;

test.describe("wizard ?destination= deeplink pre-fill @prod", () => {
  for (const c of CASES) {
    test(`${c.path} pre-fills the destination field`, async ({ page }) => {
      await page.goto(c.path);

      // The wizard applies the query string in a mount effect, so the value
      // appears only once the page has hydrated. Two render paths: a plain
      // <input> with value=, or a combobox. Poll whichever surfaces first.
      const candidates = [
        page.locator("input[role='combobox']").first(),
        page.locator("input[placeholder*='Paris'], input[placeholder*='Parigi'], input[placeholder*='Tokio']").first(),
        page.locator("form input[type='text']").first(),
      ];

      const readValue = async () => {
        for (const cand of candidates) {
          if ((await cand.count()) > 0) {
            const value = (await cand.inputValue().catch(() => "")) || "";
            if (value) return value;
          }
        }
        return "";
      };

      await expect
        .poll(readValue, {
          message: `${c.path} should pre-fill the destination "${c.expected}"`,
          timeout: 15_000,
        })
        .toMatch(new RegExp(c.expected, "i"));
    });
  }
});
