import { test, expect } from "@playwright/test";

/**
 * Share prompt on trip detail — the live half of spec C1.
 *
 * Context
 * -------
 * Commit 0fea966 moved the share ask off the save moment and onto
 * /trips/[id], behind an engagement gate (owner + no share link yet +
 * scrolled past 600px or 25s dwell + not previously dismissed).
 *
 * components/trip/SharePromptOnTrip.vitest.tsx already pins that gate at the
 * unit level, with mutation coverage. What it CANNOT prove is that the
 * component is actually mounted on the real page, reached by real data, and
 * rendered above the fold of a real trip. That is what this spec is for —
 * the gap between "the logic is right" and "the thing appears".
 *
 * Why this is skipped by default
 * ------------------------------
 * Every condition on the prompt requires an authenticated OWNER of a saved
 * trip that has no share link. There is no way to reach it anonymously, and
 * this repo (correctly) has no committed test credentials.
 *
 * Same convention as invite-acceptance-rls.spec.ts: point an env var at a
 * Playwright storageState file and the test runs; leave it unset and the
 * test skips with an explanatory message rather than failing.
 *
 * To produce the state file, once:
 *
 *   npx playwright open --save-storage=$HOME/.mt-owner-auth.json https://monkeytravel.app/auth/login
 *   # log in in the window that opens, then close it
 *   SHARE_PROMPT_AUTH_STATE=$HOME/.mt-owner-auth.json npx playwright test share-prompt
 *
 * The path is deliberately OUTSIDE the repo. That file is a live session —
 * whoever holds it is logged in as you. A repo-relative default (.auth/)
 * would be one stray `git add` away from being published, and this repo does
 * not gitignore such a directory today.
 */

const AUTH_STATE = process.env.SHARE_PROMPT_AUTH_STATE;

/** Engagement threshold from SharePromptOnTrip (SCROLL_PX = 600). */
const SCROLL_PX = 900; // comfortably past it

test.describe("share prompt on trip detail", () => {
  test.skip(
    !AUTH_STATE,
    "set SHARE_PROMPT_AUTH_STATE=path/to/storageState.json for a user who owns at least one trip with no share link"
  );

  test.use({ storageState: AUTH_STATE });

  /**
   * Finds a trip the user owns that has NOT been shared yet — the only kind
   * the prompt targets.
   *
   * There is deliberately no API call to list trips here because there is no
   * such endpoint: app/api/trips/ contains only [id]/ and duplicate/. The
   * /trips page is a server component that reads Supabase directly. An
   * earlier draft of this helper called GET /api/trips, which 404s, so every
   * run skipped with "no unshared trip" and the spec would have looked
   * healthy while testing nothing. Scrape the rendered list instead.
   */
  async function findUnsharedTrip(page: import("@playwright/test").Page) {
    await page.goto("/trips");
    await page.waitForLoadState("networkidle");

    const ids: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/trips/"]'))
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
        .map((h) => h.match(/\/trips\/([0-9a-f-]{36})(?:[/?#]|$)/i)?.[1] || "")
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
    );

    for (const id of ids) {
      const res = await page.request.get(`/api/trips/${id}/share`);
      if (!res.ok()) continue;
      const share = (await res.json()) as { shareToken?: string; shareUrl?: string };
      if (!share.shareToken && !share.shareUrl) return id;
    }
    return null;
  }

  test("does not fire on load, fires after the user scrolls in", async ({
    page,
  }) => {
    const tripId = await findUnsharedTrip(page);
    test.skip(
      !tripId,
      "no unshared trip on this account — every trip already has a link"
    );

    await page.goto(`/trips/${tripId}`);
    await page.waitForLoadState("networkidle");

    // C1's entire point: the ask must not land before the user has read
    // anything. If this assertion ever fails, the prompt has regressed back
    // to the save-moment behaviour that produced an 85% skip rate.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Clear any prior dismissal for THIS trip so the run is repeatable —
    // dismissal is deliberately permanent per trip.
    await page.evaluate(
      (id) => localStorage.removeItem(`share_prompt_dismissed:${id}`),
      tripId
    );
    await page.reload();
    await page.waitForLoadState("networkidle");

    await page.evaluate((y) => window.scrollTo(0, y), SCROLL_PX);

    // The modal is dynamically imported, so allow for the chunk fetch.
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
  });

  test("dismissal persists for that trip across a reload", async ({
    page,
  }) => {
    const tripId = await findUnsharedTrip(page);
    test.skip(!tripId, "no unshared trip on this account");

    await page.goto(`/trips/${tripId}`);
    await page.evaluate(
      (id) => localStorage.removeItem(`share_prompt_dismissed:${id}`),
      tripId
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.evaluate((y) => window.scrollTo(0, y), SCROLL_PX);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: /close|chiudi|not now|dopo/i }).click();
    await expect(dialog).toHaveCount(0);

    // Saying no once must not mean being asked again tomorrow.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.evaluate((y) => window.scrollTo(0, y), SCROLL_PX);
    await page.waitForTimeout(2_000);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
