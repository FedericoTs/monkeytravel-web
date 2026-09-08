/**
 * Moving an activity between days — the two ways a traveller can do it:
 *
 *   1. the card's ⋯ → "Move to another day…" sheet (every device)
 *   2. dragging a card onto another day's header (pointer devices)
 *
 * Both must land the card in the other day, confirm with a toast that offers
 * Undo, undo cleanly, and survive a reload through the ambient auto-save.
 *
 * Isolation: every test creates its OWN throwaway trip for the e2e owner
 * (same shape as scripts/e2e-fixtures.mts, no collaborators — so it gets the
 * ambient editor that solo owners have, which is ~99% of trips) and deletes
 * it afterwards. Nothing on the shared fixture trip is touched, and the two
 * projects can run in parallel. Needs the owner's storage state
 * (npx tsx scripts/e2e-login.mts) and the fixture trip id (only to find the
 * owner's user id).
 *
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *   BASE_URL=http://localhost:3001 \
 *     npx playwright test tests/e2e/move-between-days.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env: Record<string, string> = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const need = (k: string) => process.env[k] ?? env[k] ?? "";
const SUPA_URL = need("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const FIXTURE_TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;
const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;

function iso(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Three days, four activities, all ids prefixed `m-` so nothing collides with other specs. */
function planningItinerary() {
  return [
    {
      day_number: 1,
      date: iso(30),
      title: "Alfama and the river",
      activities: [
        { id: "m-d1a1", name: "Castelo de São Jorge", start_time: "10:00", duration_minutes: 90, type: "landmark", location: "Alfama", address: "Alfama, Lisboa", coordinates: { lat: 38.7139, lng: -9.1335 } },
        { id: "m-d1a2", name: "Time Out Market lunch", start_time: "13:00", duration_minutes: 90, type: "restaurant", location: "Cais do Sodré", address: "Av. 24 de Julho, Lisboa", coordinates: { lat: 38.707, lng: -9.1459 } },
      ],
    },
    {
      day_number: 2,
      date: iso(31),
      title: "Belém",
      activities: [
        { id: "m-d2a1", name: "Jerónimos Monastery", start_time: "09:30", duration_minutes: 90, type: "landmark", location: "Belém", address: "Praça do Império, Lisboa", coordinates: { lat: 38.6979, lng: -9.2065 } },
      ],
    },
    {
      day_number: 3,
      date: iso(32),
      title: "Sintra",
      activities: [
        { id: "m-d3a1", name: "Pena Palace", start_time: "10:00", duration_minutes: 150, type: "landmark", location: "Sintra", address: "Sintra", coordinates: { lat: 38.7876, lng: -9.3905 } },
      ],
    },
  ];
}

async function declineConsent(page: Page) {
  const btn = page.getByRole("button", { name: /essential only|solo essenziali|solo esenciales|apenas essenciais/i });
  try {
    await btn.waitFor({ state: "visible", timeout: 4000 });
    await btn.click();
  } catch {
    /* already decided */
  }
}

/**
 * A solo owner gets the editor ambiently; if a trip ever lands in the legacy
 * mode (collaborative), flip the "Edit Trip" toggle.
 */
async function ensureEditing(page: Page) {
  const actions = page.getByTestId("activity-actions").first();
  try {
    await actions.waitFor({ state: "visible", timeout: 15_000 });
    return;
  } catch {
    /* legacy mode */
  }
  await page.getByTitle(/edit trip/i).first().click();
  await actions.waitFor({ state: "visible", timeout: 10_000 });
}

/**
 * Solo trips auto-save (debounced PATCH); collaborative ones need the Save
 * button. Either way the PATCH must land before we reload.
 */
async function persist(page: Page, tripId: string) {
  const patch = page.waitForResponse(
    (r) => r.url().includes(`/api/trips/${tripId}`) && r.request().method() === "PATCH",
    { timeout: 20_000 },
  );
  const save = page.getByRole("button", { name: /^save( changes)?$/i }).first();
  if (await save.isVisible().catch(() => false)) await save.click();
  const res = await patch;
  expect(res.ok(), `PATCH /api/trips returned ${res.status()}`).toBeTruthy();
}

const cardIn = (page: Page, dayNumber: number, activityId: string) =>
  page.getByTestId(`day-drop-list-${dayNumber}`).getByTestId(`activity-card-${activityId}`);

const dayOrder = (page: Page, dayNumber: number) =>
  page
    .getByTestId(`day-drop-list-${dayNumber}`)
    .locator('[data-testid^="activity-card-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));

async function openTrip(page: Page, tripId: string) {
  await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await declineConsent(page);
  await ensureEditing(page);
  await expect(cardIn(page, 1, "m-d1a1")).toBeVisible({ timeout: 30_000 });
}

test.describe("Move an activity between days", () => {
  test.skip(
    !SUPA_URL || !SERVICE_KEY || !FIXTURE_TRIP_ID || !AUTH_STATE,
    "set SUPABASE_SERVICE_ROLE_KEY, KEY_FLOWS_TRIP_ID and KEY_FLOWS_AUTH_STATE",
  );
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 150_000 });

  let admin: SupabaseClient;
  let ownerId: string;
  let tripId: string;

  test.beforeAll(async () => {
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await admin.from("trips").select("user_id").eq("id", FIXTURE_TRIP_ID!).single();
    if (error) throw error;
    ownerId = data.user_id as string;
  });

  test.beforeEach(async () => {
    tripId = randomUUID();
    const { error } = await admin.from("trips").insert({
      id: tripId,
      user_id: ownerId,
      title: "E2E move-between-days (safe to delete)",
      description: "Automated E2E fixture. Safe to delete.",
      start_date: iso(30),
      end_date: iso(32),
      status: "planning",
      visibility: "private",
      itinerary: planningItinerary(),
      trip_meta: { destination: "Lisbon", e2e_fixture: true },
    });
    if (error) throw error;
  });

  test.afterEach(async () => {
    if (tripId) await admin.from("trips").delete().eq("id", tripId);
  });

  test("⋯ → Move to another day lands the card in its time slot, and Undo brings it back", async ({ page }) => {
    await openTrip(page, tripId);

    const card = cardIn(page, 1, "m-d1a2");
    await card.getByRole("button", { name: /more actions/i }).click();
    await page.getByRole("menuitem", { name: /move to another day/i }).click();

    const sheet = page.getByTestId("move-to-day-list");
    await sheet.waitFor({ state: "visible", timeout: 10_000 });
    await expect(page.getByTestId("move-to-day-1")).toBeDisabled(); // the day it's already on
    await page.getByTestId("move-to-day-3").click();

    // Landed on day 3 — after the 10:00 palace, because it's a 13:00 lunch.
    await expect(cardIn(page, 3, "m-d1a2")).toBeVisible({ timeout: 10_000 });
    await expect(cardIn(page, 1, "m-d1a2")).toHaveCount(0);
    expect(await dayOrder(page, 3)).toEqual(["activity-card-m-d3a1", "activity-card-m-d1a2"]);

    // Confirmed, with a way back — the toast's Undo.
    await expect(page.getByText(/moved to day 3/i)).toBeVisible();
    const undo = page.getByRole("button", { name: /^undo$/i }).last();
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(cardIn(page, 1, "m-d1a2")).toBeVisible({ timeout: 10_000 });
    await expect(cardIn(page, 3, "m-d1a2")).toHaveCount(0);
  });

  test("a move survives a reload", async ({ page }) => {
    await openTrip(page, tripId);

    await cardIn(page, 1, "m-d1a1").getByRole("button", { name: /more actions/i }).click();
    await page.getByRole("menuitem", { name: /move to another day/i }).click();
    await page.getByTestId("move-to-day-2").click();
    await expect(cardIn(page, 2, "m-d1a1")).toBeVisible({ timeout: 10_000 });
    await persist(page, tripId);

    await page.reload({ waitUntil: "domcontentloaded" });
    await declineConsent(page);
    await ensureEditing(page);
    await expect(cardIn(page, 2, "m-d1a1")).toBeVisible({ timeout: 30_000 });
    await expect(cardIn(page, 1, "m-d1a1")).toHaveCount(0);
  });

  test("dragging a card onto another day's header puts it at the start of that day", async ({ page, isMobile }) => {
    test.skip(isMobile, "pointer drag — on touch the sheet is the path");
    // A viewport taller than the whole page: nothing can scroll, so dnd-kit's
    // edge auto-scroll (bottom 20% of the viewport) can't slide the target
    // away from a resting pointer, and no coordinate goes stale.
    const viewport = { width: 1280, height: 6000 };
    await page.setViewportSize(viewport);
    await openTrip(page, tripId);
    await page.evaluate(() => window.scrollTo(0, 0));

    const handle = cardIn(page, 1, "m-d1a1").getByTestId("drag-handle");
    const header = page.getByTestId("day-drop-header-3");
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const to = await header.boundingBox();
    expect(from && to, "handle and target header must be on screen").toBeTruthy();
    expect(to!.y + to!.height, "day 3 header must be inside the viewport").toBeLessThan(viewport.height);
    expect(from!.y, "day 1 handle must be inside the viewport").toBeGreaterThanOrEqual(0);

    const startX = from!.x + from!.width / 2;
    const startY = from!.y + from!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 12, startY + 12, { steps: 4 }); // past the 5px activation distance
    // The plan reflows live while a card crosses days (the preview moves it),
    // so measure the destination header AFTER the drag is under way, then go.
    await page.mouse.move(to!.x + to!.width / 2, to!.y - 40, { steps: 15 });
    await page.waitForTimeout(150);
    const live = await header.boundingBox();
    expect(live, "day 3 header still on screen mid-drag").toBeTruthy();
    const endX = live!.x + live!.width / 2;
    const endY = live!.y + live!.height / 2;
    await page.mouse.move(endX, endY, { steps: 10 });
    // The header highlight is a one-frame state by design: as soon as the
    // pointer crosses it, the preview inserts the card at the top of Day 3
    // and the header slides up, leaving the pointer over the card itself.
    // The outcome after release is what matters.
    await page.waitForTimeout(250);
    await page.mouse.up();

    await expect(cardIn(page, 3, "m-d1a1")).toBeVisible({ timeout: 10_000 });
    expect((await dayOrder(page, 3))[0]).toBe("activity-card-m-d1a1");
    await expect(cardIn(page, 1, "m-d1a1")).toHaveCount(0);
    await expect(page.getByText(/moved to day 3/i)).toBeVisible();
  });
});
