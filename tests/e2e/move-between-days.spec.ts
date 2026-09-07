/**
 * Moving an activity between days — the two ways a traveller can do it:
 *
 *   1. the card's ⋯ → "Move to another day…" sheet (every device)
 *   2. dragging a card onto another day's header (pointer devices)
 *
 * Both must land the card in the other day, confirm with a toast that offers
 * Undo, undo cleanly, and survive a reload (auto-save on solo trips, the
 * legacy Save button on collaborative ones).
 *
 * Self-contained like today.spec.ts: the service role pins a known 3-day
 * planning itinerary on the fixture trip (dates in the future, so the owner
 * gets the editor), then restores the row. Needs the owner's storage state
 * (npx tsx scripts/e2e-login.mts) and the fixture trip id. Run with ONE
 * worker — both projects share the same trip row.
 *
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *   BASE_URL=http://localhost:3001 \
 *     npx playwright test tests/e2e/move-between-days.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
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
const TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;
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
 * Solo owners get the editor ambiently. A collaborative fixture (the e2e trip
 * has a mate and a voter) keeps the legacy "Edit Trip" toggle — flip it.
 */
async function ensureEditing(page: Page) {
  const actions = page.getByTestId("activity-actions").first();
  try {
    await actions.waitFor({ state: "visible", timeout: 8000 });
    return;
  } catch {
    /* legacy mode */
  }
  await page.getByTitle(/edit trip/i).first().click();
  await actions.waitFor({ state: "visible", timeout: 10000 });
}

/**
 * Solo trips auto-save (debounced PATCH); collaborative ones need the Save
 * button. Either way the PATCH must land before we reload.
 */
async function persist(page: Page, tripId: string) {
  const patch = page.waitForResponse(
    (r) => r.url().includes(`/api/trips/${tripId}`) && r.request().method() === "PATCH",
    { timeout: 20000 },
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

async function openTrip(page: Page) {
  await page.goto(`/en/trips/${TRIP_ID}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await declineConsent(page);
  await ensureEditing(page);
  await expect(cardIn(page, 1, "m-d1a1")).toBeVisible({ timeout: 30_000 });
}

test.describe("Move an activity between days", () => {
  test.skip(
    !SUPA_URL || !SERVICE_KEY || !TRIP_ID || !AUTH_STATE,
    "set SUPABASE_SERVICE_ROLE_KEY, KEY_FLOWS_TRIP_ID and KEY_FLOWS_AUTH_STATE",
  );
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 150_000, mode: "serial" });

  let admin: SupabaseClient;
  let original: Record<string, unknown>;

  test.beforeAll(async () => {
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await admin
      .from("trips")
      .select("start_date, end_date, itinerary, trip_meta, status")
      .eq("id", TRIP_ID!)
      .single();
    if (error) throw error;
    original = data as Record<string, unknown>;
  });

  test.beforeEach(async () => {
    const patch: Record<string, unknown> = {
      start_date: iso(30),
      end_date: iso(32),
      itinerary: planningItinerary(),
      ...(original.status === "active" ? { status: "planning" } : {}),
    };
    const { error } = await admin.from("trips").update(patch).eq("id", TRIP_ID!);
    if (error) throw error;
  });

  test.afterAll(async () => {
    if (admin && original) await admin.from("trips").update(original).eq("id", TRIP_ID!);
  });

  test("⋯ → Move to another day lands the card in its time slot, and Undo brings it back", async ({ page }) => {
    await openTrip(page);

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

    // Confirmed, with a way back.
    await expect(page.getByText(/moved to day 3/i)).toBeVisible();
    const undo = page.getByRole("button", { name: /^undo$/i }).last();
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(cardIn(page, 1, "m-d1a2")).toBeVisible({ timeout: 10_000 });
    await expect(cardIn(page, 3, "m-d1a2")).toHaveCount(0);
  });

  test("a move survives a reload", async ({ page }) => {
    await openTrip(page);

    await cardIn(page, 1, "m-d1a1").getByRole("button", { name: /more actions/i }).click();
    await page.getByRole("menuitem", { name: /move to another day/i }).click();
    await page.getByTestId("move-to-day-2").click();
    await expect(cardIn(page, 2, "m-d1a1")).toBeVisible({ timeout: 10_000 });
    await persist(page, TRIP_ID!);

    await page.reload({ waitUntil: "domcontentloaded" });
    await declineConsent(page);
    await ensureEditing(page);
    await expect(cardIn(page, 2, "m-d1a1")).toBeVisible({ timeout: 30_000 });
    await expect(cardIn(page, 1, "m-d1a1")).toHaveCount(0);
  });

  test("dragging a card onto another day's header puts it at the start of that day", async ({ page, isMobile }) => {
    test.skip(isMobile, "pointer drag — on touch the sheet is the path");
    // Tall viewport: the whole plan on screen, so the drag needs no auto-scroll.
    await page.setViewportSize({ width: 1280, height: 2400 });
    await openTrip(page);

    const handle = cardIn(page, 1, "m-d1a1").getByTestId("drag-handle");
    const header = page.getByTestId("day-drop-header-3");
    const from = await handle.boundingBox();
    const to = await header.boundingBox();
    expect(from && to, "handle and target header must be on screen").toBeTruthy();

    const startX = from!.x + from!.width / 2;
    const startY = from!.y + from!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 12, startY + 12, { steps: 4 }); // past the 5px activation distance
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 25 });
    await expect(header).toHaveAttribute("data-drop-over", "true");
    await page.mouse.up();

    await expect(cardIn(page, 3, "m-d1a1")).toBeVisible({ timeout: 10_000 });
    expect((await dayOrder(page, 3))[0]).toBe("activity-card-m-d1a1");
    await expect(cardIn(page, 1, "m-d1a1")).toHaveCount(0);
    await expect(page.getByText(/moved to day 3/i)).toBeVisible();
  });
});
