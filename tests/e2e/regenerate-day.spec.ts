/**
 * Regenerating one day of a trip, as a solo owner: the new day replaces the
 * old one and the rest of the plan stays, an edit made just before is saved
 * first and kept, Undo takes a regenerated day back, and a refused
 * regeneration says why and changes nothing, Undo and Redo included.
 *
 * The regenerate call is answered by the test the way the server answers it:
 * the new day is written to the trip with the service client, which moves
 * itinerary_version as the server's write does, and the reply carries the
 * versions before and after. No model runs. Every test gets a trip of its own,
 * a few weeks out, removed afterwards.
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/regenerate-day.spec.ts --project=chromium
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

type Day = { day_number: number; date?: string; activities: { id: string; name: string }[] };

function itinerary() {
  return [
    {
      day_number: 1,
      date: iso(30),
      title: "Alfama",
      activities: [
        { id: "r-d1a1", name: "Castelo de São Jorge", start_time: "10:00", duration_minutes: 90, type: "landmark", location: "Alfama" },
        { id: "r-d1a2", name: "Time Out Market lunch", start_time: "13:00", duration_minutes: 90, type: "restaurant", location: "Cais do Sodré" },
      ],
    },
    {
      day_number: 2,
      date: iso(31),
      title: "Belém",
      activities: [{ id: "r-d2a1", name: "Jerónimos Monastery", start_time: "09:30", duration_minutes: 90, type: "landmark", location: "Belém" }],
    },
    {
      day_number: 3,
      date: iso(32),
      title: "Sintra",
      activities: [{ id: "r-d3a1", name: "Pena Palace", start_time: "10:00", duration_minutes: 150, type: "landmark", location: "Sintra" }],
    },
  ];
}

/** What the "model" puts on the regenerated day. */
const NEW_DAY_ACTIVITY = { id: "r-new-1", name: "LX Factory brunch", start_time: "10:30", duration_minutes: 90, type: "restaurant", location: "Alcântara" };

async function declineConsent(page: Page) {
  const btn = page.getByRole("button", { name: /essential only|solo essenziali|solo esenciales|apenas essenciais/i });
  try {
    await btn.waitFor({ state: "visible", timeout: 4000 });
    await btn.click();
  } catch {
    /* already decided */
  }
}

const cardIn = (page: Page, dayNumber: number, activityId: string) =>
  page.getByTestId(`day-drop-list-${dayNumber}`).getByTestId(`activity-card-${activityId}`);

async function openTrip(page: Page, tripId: string) {
  await page.addInitScript((id) => {
    localStorage.setItem(`share_prompt_dismissed:${id}`, "1");
    localStorage.setItem("mt_ai_assistant_seen", String(Date.now()));
  }, tripId);
  await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await declineConsent(page);
  await expect(cardIn(page, 1, "r-d1a2")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("activity-actions").first()).toBeVisible({ timeout: 15_000 });
}

async function moveLunchToDay3(page: Page) {
  await cardIn(page, 1, "r-d1a2").getByRole("button", { name: /more actions/i }).click();
  await page.getByRole("menuitem", { name: /move to another day/i }).click();
  await page.getByTestId("move-to-day-3").click();
  await expect(cardIn(page, 3, "r-d1a2")).toBeVisible({ timeout: 10_000 });
}

async function regenerateDay2(page: Page, instructions?: string) {
  await page.getByRole("button", { name: "Regenerate Day 2" }).click();
  const dialog = page.getByRole("dialog", { name: "Regenerate Day 2?" });
  await expect(dialog).toBeVisible();
  if (instructions) await dialog.getByRole("textbox").fill(instructions);
  await dialog.getByRole("button", { name: "Regenerate day" }).click();
}

test.describe("regenerate a day", () => {
  test.skip(
    !SUPA_URL || !SERVICE_KEY || !FIXTURE_TRIP_ID || !AUTH_STATE,
    "set SUPABASE_SERVICE_ROLE_KEY, KEY_FLOWS_TRIP_ID and KEY_FLOWS_AUTH_STATE",
  );
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 150_000 });

  let admin: SupabaseClient;
  let ownerId: string;
  let tripId: string;
  let requests: { dayNumber: number; instructions?: string }[];

  const stored = async () => {
    const { data, error } = await admin.from("trips").select("itinerary").eq("id", tripId).single();
    if (error) throw error;
    return data.itinerary as Day[];
  };
  const idsByDay = (days: Day[]) => days.map((d) => d.activities.map((a) => a.id));

  /** Answers the regeneration as the server does: store the day, reply with both versions. */
  async function answerAsServer(page: Page) {
    await page.route("**/api/ai/regenerate-day", async (route) => {
      const body = route.request().postDataJSON() as { tripId: string; dayNumber: number; instructions?: string };
      requests.push({ dayNumber: body.dayNumber, instructions: body.instructions });
      const { data, error } = await admin.from("trips").select("itinerary, itinerary_version").eq("id", tripId).single();
      if (error) throw error;
      const days = (data.itinerary as Day[]).map((d) =>
        d.day_number === body.dayNumber ? { ...d, title: "Alcântara", activities: [NEW_DAY_ACTIVITY] } : d,
      );
      const { data: written, error: writeError } = await admin
        .from("trips")
        .update({ itinerary: days })
        .eq("id", tripId)
        .select("itinerary_version")
        .single();
      if (writeError) throw writeError;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          day: days.find((d) => d.day_number === body.dayNumber),
          dayIndex: body.dayNumber - 1,
          fromVersion: data.itinerary_version,
          itineraryVersion: written.itinerary_version,
        }),
      });
    });
  }

  test.beforeAll(async () => {
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await admin.from("trips").select("user_id").eq("id", FIXTURE_TRIP_ID!).single();
    if (error) throw error;
    ownerId = data.user_id as string;
  });

  test.beforeEach(async () => {
    requests = [];
    tripId = randomUUID();
    const { error } = await admin.from("trips").insert({
      id: tripId,
      user_id: ownerId,
      title: "E2E regenerate day (safe to delete)",
      description: "Automated E2E fixture. Safe to delete.",
      start_date: iso(30),
      end_date: iso(32),
      status: "planning",
      visibility: "private",
      itinerary: itinerary(),
      trip_meta: { destination: "Lisbon", e2e_fixture: true },
    });
    if (error) throw error;
  });

  test.afterEach(async () => {
    if (tripId) await admin.from("trips").delete().eq("id", tripId);
  });

  test("the new day replaces the old one, the rest stays, and later edits save on top", async ({ page }) => {
    await answerAsServer(page);
    await openTrip(page, tripId);
    await regenerateDay2(page, "a slower day with a long lunch");

    await expect(page.getByText("Day 2 regenerated")).toBeVisible({ timeout: 30_000 });
    await expect(cardIn(page, 2, "r-new-1")).toBeVisible();
    await expect(cardIn(page, 2, "r-d2a1")).toHaveCount(0);
    expect(requests).toEqual([{ dayNumber: 2, instructions: "a slower day with a long lunch" }]);

    // The page took the stored version as its own: the next edit saves, no conflict.
    await moveLunchToDay3(page);
    await expect.poll(async () => idsByDay(await stored()), { timeout: 30_000 }).toEqual([["r-d1a1"], ["r-new-1"], ["r-d3a1", "r-d1a2"]]);
    await expect(page.getByTestId("itinerary-conflict")).toHaveCount(0);
  });

  test("an edit made just before is saved first and kept", async ({ page }) => {
    await answerAsServer(page);
    await openTrip(page, tripId);
    await moveLunchToDay3(page);
    await regenerateDay2(page);

    await expect(page.getByText("Day 2 regenerated")).toBeVisible({ timeout: 30_000 });
    await expect(cardIn(page, 3, "r-d1a2")).toBeVisible();
    await expect(cardIn(page, 2, "r-new-1")).toBeVisible();
    await expect.poll(async () => idsByDay(await stored()), { timeout: 30_000 }).toEqual([["r-d1a1"], ["r-new-1"], ["r-d3a1", "r-d1a2"]]);
    await expect(page.getByTestId("itinerary-conflict")).toHaveCount(0);
  });

  test("a refused regeneration says why and changes nothing", async ({ page }) => {
    await page.route("**/api/ai/regenerate-day", (route) =>
      route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { message: "limit" } }) }),
    );
    await openTrip(page, tripId);
    await regenerateDay2(page);

    await expect(page.getByText("You've reached this month's regeneration limit. Your day is unchanged.").first()).toBeVisible({ timeout: 30_000 });
    await expect(cardIn(page, 2, "r-d2a1")).toBeVisible();
    expect(idsByDay(await stored())).toEqual(idsByDay(itinerary() as Day[]));
  });

  // The bar's Undo and Redo carry a title; a toast's Undo does not.
  const undoButton = (page: Page) => page.getByTitle("Undo", { exact: true });
  const redoButton = (page: Page) => page.getByTitle("Redo", { exact: true });

  test("a regenerated day can be undone", async ({ page }) => {
    await answerAsServer(page);
    await openTrip(page, tripId);
    await regenerateDay2(page);
    await expect(page.getByText("Day 2 regenerated")).toBeVisible({ timeout: 30_000 });
    await expect(cardIn(page, 2, "r-new-1")).toBeVisible();

    await undoButton(page).click();
    await expect(cardIn(page, 2, "r-d2a1")).toBeVisible();
    await expect.poll(async () => idsByDay(await stored()), { timeout: 30_000 }).toEqual(idsByDay(itinerary() as Day[]));
  });

  test("a refused regeneration leaves undo and redo as they were", async ({ page }) => {
    await page.route("**/api/ai/regenerate-day", (route) =>
      route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { message: "limit" } }) }),
    );
    await openTrip(page, tripId);
    // An edit, undone: nothing left to undo, and the edit to redo.
    await moveLunchToDay3(page);
    await undoButton(page).click();
    await expect(cardIn(page, 1, "r-d1a2")).toBeVisible();
    await expect(undoButton(page)).toBeDisabled();
    await expect(redoButton(page)).toBeEnabled();

    await regenerateDay2(page);
    await expect(page.getByText("You've reached this month's regeneration limit. Your day is unchanged.").first()).toBeVisible({ timeout: 30_000 });
    await expect(undoButton(page)).toBeDisabled();
    await expect(redoButton(page)).toBeEnabled();
  });
});
