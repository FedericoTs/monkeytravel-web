import { test, expect } from "@playwright/test";

/**
 * P0 collaboration bug fixes — verified live against monkeytravel.app.
 *
 * Coverage:
 *   - B2: invalid-invite page <title> no longer double-includes the
 *         "MonkeyTravel" brand suffix (root layout already appends it).
 *   - B3: invalid-shared page renders the new friendly card instead of
 *         the global monkey-404 — same visual language as the invite
 *         error page.
 *
 * B1 (personal message rendered on accept page) needs an authenticated
 * fixture user + a real invite token to verify end-to-end; the build-
 * level type check ensures the prop is plumbed through, but functional
 * verification belongs in a follow-up with a seeded test setup.
 */

test.describe("Collab P0 fixes @prod", () => {
  test("B2: invalid invite page <title> isn't duplicated", async ({ page }) => {
    await page.goto("/invite/this-token-does-not-exist");
    const title = await page.title();
    // Root layout adds " | MonkeyTravel" via metadata.title.template.
    // The page-level title must NOT include the suffix itself, or we
    // end up with "X | MonkeyTravel | MonkeyTravel" (caught live in
    // the COLLAB_AUDIT before this fix).
    const monkeyOccurrences = (title.match(/MonkeyTravel/g) ?? []).length;
    expect(
      monkeyOccurrences,
      `<title> should contain "MonkeyTravel" exactly once, got: "${title}"`
    ).toBe(1);
  });

  test("B3: invalid shared trip uses friendly card (not generic 404)", async ({
    page,
  }) => {
    await page.goto("/shared/00000000-0000-0000-0000-000000000000");
    // The new co-located not-found.tsx renders a friendly card with a
    // specific heading + CTA. Asserting on these visible elements is
    // enough — the heading text is the unique regression marker (the
    // old global 404 monkey page used "Looks like you took a wrong
    // turn" + "Back to Home", not these strings).
    //
    // We don't assert "wrong turn" is absent because body.textContent()
    // also includes Next.js's serialized React Flight payload, which
    // can reference other routes' bundled content even when they don't
    // render. The visible-heading positive assertion is the safer test.
    await expect(
      page.getByRole("heading", { name: /shared trip isn.?t available/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /plan your own trip/i })
    ).toBeVisible();
  });
});

test.describe("Trip intent measurement toggle @prod", () => {
  test("wizard step 1 shows the Who's coming? toggle with two options", async ({
    page,
  }) => {
    await page.goto("/trips/new");
    // The toggle is the Phase-1 measurement experiment — both options
    // must be present (no JS-side feature flag yet, it's pure HTML).
    await expect(
      page.getByRole("button", { name: /just me/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /with friends/i })
    ).toBeVisible();
  });

  test("clicking With friends shows the contextual hint", async ({ page }) => {
    await page.goto("/trips/new");
    await page.getByRole("button", { name: /with friends/i }).click();
    await expect(
      page.locator("text=/invite friends to vote after/i")
    ).toBeVisible();
  });
});
