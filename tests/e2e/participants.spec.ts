/**
 * Live Trip Phase 2 — two-context flow:
 *   owner mints a share link ⇄ an anonymous recipient taps "I'm going" and
 *   gives a name ⇄ the owner sees them under "Who's going" and removes them.
 *
 * Needs the same fixtures as key-flows.spec.ts:
 *   KEY_FLOWS_AUTH_STATE  — a Playwright storageState for the owner
 *   KEY_FLOWS_TRIP_ID     — a trip that owner owns
 * Skipped without them.
 *
 *   npx playwright test tests/e2e/participants.spec.ts --project=chromium
 */
import { test, expect, type Page } from "@playwright/test";

const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;
const TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;

async function declineConsent(page: Page) {
  const btn = page.getByRole("button", { name: /essential only|solo essenziali|solo esenciales|apenas essenciais/i });
  try {
    await btn.waitFor({ state: "visible", timeout: 4000 });
    await btn.click();
  } catch {
    // no banner (already decided) — fine
  }
}

function payload(json: unknown): Record<string, unknown> {
  const j = json as { data?: Record<string, unknown> } | Record<string, unknown>;
  return ((j as { data?: Record<string, unknown> }).data ?? j) as Record<string, unknown>;
}

test.describe("recipient → participant", () => {
  test.skip(!AUTH_STATE || !TRIP_ID, "set KEY_FLOWS_AUTH_STATE and KEY_FLOWS_TRIP_ID");
  test.use({ storageState: AUTH_STATE });
  // Three page loads across two contexts; against a cold dev server the owner
  // page alone can take most of the default minute to compile.
  test.describe.configure({ timeout: 180_000 });

  test("anon recipient taps I'm going; owner sees and removes them", async ({ request, browser, page }) => {
    const name = `E2E Going ${Date.now().toString(36)}`;

    // 1. owner mints the link
    const res = await request.post(`/api/trips/${TRIP_ID}/share`);
    expect(res.status(), "share mint failed").toBe(200);
    const token = payload(await res.json()).shareToken as string;
    expect(token).toBeTruthy();

    // 2. an anonymous recipient says they're going.
    // Force an empty session: under the describe-level storageState, a bare
    // browser.newContext() can carry the owner cookie, which would render the
    // owner's "Who's going" card instead of the recipient's "I'm going" bar.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const rp = await anon.newPage();
      // networkidle + a generous timeout: the first /shared/[token] hit on a
      // cold dev server compiles the route before it can render the bar.
      const r = await rp.goto(`/shared/${token}`, { waitUntil: "networkidle", timeout: 120_000 });
      expect(r?.status()).toBeLessThan(400);
      await declineConsent(rp);

      const bar = rp.getByTestId("participants-bar");
      await expect(bar).toBeVisible({ timeout: 30_000 });
      await rp.getByTestId("participants-join").click();
      await expect(rp.getByTestId("participants-joined")).toBeVisible();

      await rp.getByTestId("participants-name").fill(name);
      await rp.getByTestId("participants-name").press("Enter");
      // the email step follows; skip it
      await rp.getByRole("button", { name: /skip|omitir|salta|pular/i }).click();
      await expect(rp.getByTestId("participants-done")).toBeVisible();

      // the header count reflects it on reload
      await rp.reload();
      await expect(rp.getByTestId("participants-joined")).toBeVisible();
      const count = Number(await rp.getByTestId("participants-count").getAttribute("data-count"));
      expect(count).toBeGreaterThanOrEqual(1);
    } finally {
      await anon.close();
    }

    // 3. the owner sees them
    await page.goto(`/trips/${TRIP_ID}`);
    await declineConsent(page);
    const card = page.getByTestId("who-is-going");
    await expect(card).toBeVisible();
    const row = card.getByTestId("who-is-going-row").filter({ hasText: name });
    await expect(row).toBeVisible();

    // 4. ...and removes them (cleanup doubles as the assertion)
    await row.getByRole("button", { name: /remove|quitar|rimuovi|remover/i }).click();
    await expect(row).toHaveCount(0);

    const list = await request.get(`/api/trips/${TRIP_ID}/participants`);
    expect(list.status()).toBe(200);
    const remaining = (payload(await list.json()).participants as { display_name: string | null }[]) ?? [];
    expect(remaining.some((p) => p.display_name === name)).toBe(false);
  });
});
