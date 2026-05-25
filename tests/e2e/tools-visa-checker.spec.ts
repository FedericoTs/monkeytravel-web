import { test, expect } from "@playwright/test";

/**
 * /tools/visa-checker — read-only smoke tests against the live tool.
 *
 * Guards against the bug class found on 2026-05-25:
 *  - matrix.json keys uppercase but lookup lowercased → "no data" for
 *    every pair (commit 7818103)
 *  - t() call missing `status.` prefix → renders raw key path like
 *    "tools.visaChecker.eta days" instead of localized label
 *    (commit a25564d)
 *
 * All @prod-safe.
 */

test.describe("visa-checker page @prod", () => {
  test("renders form on /tools/visa-checker", async ({ page }) => {
    await page.goto("/tools/visa-checker");
    await expect(page.locator("h1")).toHaveText("Visa Requirements Checker");
    await expect(page.locator("select#visa-from")).toBeVisible();
    await expect(page.locator("select#visa-to")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /check requirements/i })
    ).toBeVisible();
  });

  test("US→JP shows 'Visa-free for up to 90 days' (not raw key path)", async ({
    page,
  }) => {
    await page.goto("/tools/visa-checker?from=US&to=JP");
    const body = await page.locator("body").innerText();
    expect(
      body,
      "result must be a localized label, not the raw 'tools.visaChecker.X' key"
    ).not.toMatch(/tools\.visaChecker/);
    expect(body).toContain("Visa-free for up to 90 days");
  });

  test("GB→AU shows Electronic Travel Authorization", async ({ page }) => {
    await page.goto("/tools/visa-checker?from=GB&to=AU");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/tools\.visaChecker/);
    expect(body).toMatch(/electronic travel authorization/i);
  });

  test("invalid pair shows 'no data' fallback (not a server error)", async ({
    page,
  }) => {
    // ZZ and XX aren't ISO-2 codes that exist in the matrix. Server
    // should render the friendly empty-state, not 500.
    const res = await page.goto("/tools/visa-checker?from=ZZ&to=XX");
    expect(res?.status()).toBe(200);
    const body = await page.locator("body").innerText();
    expect(body).toContain("We don't have data for that pair yet");
  });

  test("/it/tools/visa-checker?from=GB&to=AU renders Italian label", async ({
    page,
  }) => {
    await page.goto("/it/tools/visa-checker?from=GB&to=AU");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/tools\.visaChecker/);
    // Italian status label for eta + days
    expect(body).toMatch(/autorizzazione elettronica di viaggio/i);
  });

  test("/es/tools/visa-checker?from=ES&to=US renders Spanish label", async ({
    page,
  }) => {
    await page.goto("/es/tools/visa-checker?from=ES&to=US");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/tools\.visaChecker/);
    // ES → US is ESTA / eTA — Spanish label
    expect(body).toMatch(/autorización electrónica de viaje/i);
  });

  test("submitting the form pushes ?from=&to= to URL", async ({ page }) => {
    await page.goto("/tools/visa-checker");
    await page.locator("select#visa-from").selectOption("US");
    await page.locator("select#visa-to").selectOption("FR");
    await page.waitForTimeout(300); // Let React state settle
    // Use Promise.all + waitForURL so we don't race the click vs the
    // router push — Playwright then waits for the URL to actually
    // change before we assert.
    await Promise.all([
      page.waitForURL(/from=US/, { timeout: 10_000 }),
      page.getByRole("button", { name: /check requirements/i }).click(),
    ]);
    expect(new URL(page.url()).search).toMatch(/to=FR/);
  });

  test("swap button exchanges from and to", async ({ page }) => {
    await page.goto("/tools/visa-checker?from=US&to=JP");
    // Pre-fills come from the URL; click swap and verify the selects flip.
    await expect(page.locator("select#visa-from")).toHaveValue("US");
    await expect(page.locator("select#visa-to")).toHaveValue("JP");
    await page.getByRole("button", { name: /swap/i }).first().click();
    await expect(page.locator("select#visa-from")).toHaveValue("JP");
    await expect(page.locator("select#visa-to")).toHaveValue("US");
  });
});
