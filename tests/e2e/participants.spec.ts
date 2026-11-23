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
      // A generous timeout: the first /shared/[token] hit on a cold dev server
      // compiles the route. Not networkidle: the page polls its live feed.
      const r = await rp.goto(`/shared/${token}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      expect(r?.status()).toBeLessThan(400);
      await declineConsent(rp);

      const bar = rp.getByTestId("participants-bar");
      await expect(bar).toBeVisible({ timeout: 30_000 });
      await rp.getByTestId("participants-join").click();
      await expect(rp.getByTestId("participants-joined")).toBeVisible();

      await rp.getByTestId("participants-name").fill(name);
      await rp.getByTestId("participants-name").press("Enter");
      // the email step follows; skip it. Scoped to the bar: a trip that runs
      // today also shows the Today card, whose "Skip this" matches /skip/.
      await bar.getByRole("button", { name: /^(skip|omitir|salta|pular)$/i }).click();
      await expect(rp.getByTestId("participants-done")).toBeVisible();

      // the header count reflects it on reload
      await rp.reload();
      await expect(rp.getByTestId("participants-joined")).toBeVisible();
      const count = Number(await rp.getByTestId("participants-count").getAttribute("data-count"));
      expect(count).toBeGreaterThanOrEqual(1);
    } finally {
      await anon.close();
    }

    // 3. the owner sees them (the assistant's first open would cover the card on mobile)
    await page.addInitScript(() => localStorage.setItem("mt_ai_assistant_seen", String(Date.now())));
    await page.goto(`/trips/${TRIP_ID}`);
    await declineConsent(page);
    // The group waits behind its chip, which carries the count.
    await expect(page.getByTestId("trip-strip-who")).toContainText(/\d+ going/);
    await page.getByTestId("trip-strip-who").click();
    const card = page.getByTestId("who-is-going");
    await expect(card).toBeVisible();
    const row = card.getByTestId("who-is-going-row").filter({ hasText: name });
    await expect(row).toBeVisible();

    // 4. ...and removes them (cleanup doubles as the assertion). The row goes
    // optimistically, so wait for the server to confirm before reading the list.
    const removed = page.waitForResponse(
      (r) => r.request().method() === "DELETE" && r.url().includes(`/api/trips/${TRIP_ID}/participants/`),
    );
    await row.getByRole("button", { name: /remove|quitar|rimuovi|remover/i }).click();
    expect((await removed).ok(), "participant removal failed").toBe(true);
    await expect(row).toHaveCount(0);

    const list = await request.get(`/api/trips/${TRIP_ID}/participants`);
    expect(list.status()).toBe(200);
    const remaining = (payload(await list.json()).participants as { display_name: string | null }[]) ?? [];
    expect(remaining.some((p) => p.display_name === name)).toBe(false);
  });

  // The fit and the Undo are answered by the test: no model call, and the stored trip is not changed.
  test("a guest's must-do: the owner adds it to the plan, which says whose pick it is, and Undo takes it out", async ({ request, browser, page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E Picks ${stamp}`;
    const pick = `E2E Granja ${stamp}`;
    const res = await request.post(`/api/trips/${TRIP_ID}/share`);
    expect(res.status(), "share mint failed").toBe(200);
    const token = payload(await res.json()).shareToken as string;

    // 1. a guest says they're going, with one must-do, through the route the bar uses
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const joined = await anon.request.post(`/api/shared/${token}/join`, { data: { action: "join", display_name: name, picks: [pick] } });
      expect(joined.status(), "join failed").toBe(200);
    } finally {
      await anon.close();
    }

    // 2. the plan as stored, and what adding the must-do would make of it (on the first day, which the trip starts today)
    const tripRes = await request.get(`/api/trips/${TRIP_ID}`);
    expect(tripRes.status()).toBe(200);
    const stored = payload(await tripRes.json()).trip as {
      itinerary: Array<{ day_number: number; activities: Array<Record<string, unknown>> }>;
      itinerary_version: number;
    };
    const added = { id: `act_e2e${stamp}`.slice(0, 16), name: pick, type: "food", start_time: "21:30", time_slot: "evening", duration_minutes: 30, description: "", location: "", tips: [], picked_by: name };
    const withPick = stored.itinerary.map((d, i) => (i === 0 ? { ...d, activities: [...d.activities, added] } : d));
    const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ data: body }) });
    await page.route(`**/api/trips/${TRIP_ID}/participants/*/fit`, (route) =>
      route.fulfill(
        route.request().method() === "POST"
          ? json({ added: [pick], notFitted: [], itinerary: withPick, previousItinerary: stored.itinerary, fromVersion: stored.itinerary_version, itineraryVersion: stored.itinerary_version })
          : json({ reset: true }),
      ),
    );
    await page.route("**/api/ai/assistant/undo", (route) =>
      route.fulfill(json({ success: true, restoredItinerary: stored.itinerary, itineraryVersion: stored.itinerary_version })),
    );

    // 3. the owner sees it under "Who's going" and adds it
    await page.addInitScript(() => localStorage.setItem("mt_ai_assistant_seen", String(Date.now())));
    await page.goto(`/trips/${TRIP_ID}`);
    await declineConsent(page);
    await page.getByTestId("trip-strip-who").click();
    const card = page.getByTestId("who-is-going");
    const theirs = card.getByTestId("who-is-going-pick").filter({ hasText: name });
    await expect(theirs).toContainText(pick);
    await theirs.getByRole("button", { name: /^(add to the plan|añadir al plan|aggiungi al piano|adicionar ao plano)$/i }).click();
    await expect(theirs).toContainText(/added to the plan|añadido al plan|aggiunto al piano|adicionado ao plano/i);

    // the page took the plan: the stop is on it, saying whose pick it is
    const label = page.getByText(new RegExp(`^(${name}'s pick|Elegido por ${name}|Scelto da ${name}|Escolha de ${name})$`));
    await expect(label.first()).toBeAttached();

    // 4. Undo puts the plan back, and the must-do is offered again
    await theirs.getByRole("button", { name: /^(undo|deshacer|annulla|desfazer)$/i }).click();
    await expect(label).toHaveCount(0);
    await expect(theirs.getByRole("button", { name: /^(add to the plan|añadir al plan|aggiungi al piano|adicionar ao plano)$/i })).toBeVisible();

    // cleanup: the guest leaves the group
    const list = await request.get(`/api/trips/${TRIP_ID}/participants`);
    const rows = (payload(await list.json()).participants as { display_name: string | null; participant_id: string | null }[]) ?? [];
    const row = rows.find((p) => p.display_name === name);
    expect(row?.participant_id, "the guest is in the group").toBeTruthy();
    const removed = await request.delete(`/api/trips/${TRIP_ID}/participants/${row!.participant_id}`);
    expect(removed.ok(), "participant removal failed").toBe(true);
  });
});
