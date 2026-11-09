/**
 * Editing a saved trip by hand, as its solo owner, saved for real and read
 * back from the database or after a reload:
 *
 *   - tapping a stop opens its editor; a longer stop makes room after it, and
 *     the message's Undo puts the times back;
 *   - a new start time puts the stop in its place;
 *   - a time typed while the stop before is still on is kept, the overlap is
 *     noted, and "Make room" moves the next stop;
 *   - a booked next stop is never moved, and a fixed plan is marked;
 *   - a stop added at a time lands in its place, with the length picked, and
 *     no made-up place on the map;
 *   - new dates move the days, add empty ones, and the assistant opens asking
 *     for them.
 *
 * Isolation as in move-between-days.spec.ts: every test creates its own
 * throwaway trip for the e2e owner and deletes it afterwards.
 *
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *   BASE_URL=http://localhost:3001 \
 *     npx playwright test tests/e2e/trip-editing.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envVar } from "./env";

const SUPA_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const FIXTURE_TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;
const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;

function iso(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

type Stop = Record<string, unknown> & { id: string; name: string; start_time: string; duration_minutes: number };
const stop = (id: string, name: string, start_time: string, duration_minutes: number, lat: number, lng: number, extra: Record<string, unknown> = {}): Stop => ({
  id,
  name,
  start_time,
  duration_minutes,
  type: "landmark",
  location: "Lisbon",
  address: "Lisbon",
  coordinates: { lat, lng },
  ...extra,
});

/** Three days; ids prefixed `e-` so nothing collides with other specs. */
function itinerary() {
  return [
    {
      day_number: 1,
      date: iso(30),
      title: "Alfama and the river",
      activities: [
        stop("e-d1a1", "Castelo de São Jorge", "10:00", 90, 38.7139, -9.1335),
        stop("e-d1a2", "Time Out Market lunch", "13:00", 90, 38.707, -9.1459, { type: "restaurant" }),
        stop("e-d1a3", "Fado in Alfama", "19:00", 120, 38.7114, -9.1301, { type: "entertainment" }),
      ],
    },
    {
      day_number: 2,
      date: iso(31),
      title: "Belém, then north",
      activities: [
        // Still on at 10:30, when the booked train leaves.
        stop("e-d2a1", "Jerónimos Monastery", "09:30", 90, 38.6979, -9.2065),
        stop("e-d2a2", "Train to Porto", "10:30", 60, 38.7139, -9.1225, { type: "transport", booking_required: true }),
        stop("e-d2a3", "Concert at Casa da Música", "21:00", 120, 41.1588, -8.6307, { type: "entertainment", locked: true }),
      ],
    },
    {
      day_number: 3,
      date: iso(32),
      title: "Porto",
      activities: [stop("e-d3a1", "Livraria Lello", "10:00", 60, 41.1469, -8.6149)],
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

const cardIn = (page: Page, dayNumber: number, activityId: string) =>
  page.getByTestId(`day-drop-list-${dayNumber}`).getByTestId(`activity-card-${activityId}`);

const dayOrder = (page: Page, dayNumber: number) =>
  page
    .getByTestId(`day-drop-list-${dayNumber}`)
    .locator('[data-testid^="activity-card-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));

async function openTrip(page: Page, tripId: string) {
  // The share prompt and the assistant's first open are timed overlays.
  await page.addInitScript((id) => {
    localStorage.setItem(`share_prompt_dismissed:${id}`, "1");
    localStorage.setItem("mt_ai_assistant_seen", String(Date.now()));
  }, tripId);
  await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await declineConsent(page);
  await page.getByTestId("activity-actions").first().waitFor({ state: "visible", timeout: 30_000 });
  await expect(cardIn(page, 1, "e-d1a1")).toBeVisible({ timeout: 30_000 });
}

/** Runs `action` and waits for the trip's next save to land. */
async function saved(page: Page, tripId: string, action: () => Promise<void>) {
  const patch = page.waitForResponse((r) => r.url().includes(`/api/trips/${tripId}`) && r.request().method() === "PATCH", {
    timeout: 20_000,
  });
  await action();
  const res = await patch;
  expect(res.ok(), `PATCH /api/trips returned ${res.status()}`).toBeTruthy();
}

async function reopen(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await declineConsent(page);
  await page.getByTestId("activity-actions").first().waitFor({ state: "visible", timeout: 30_000 });
}

test.describe("Editing a saved trip by hand", () => {
  test.skip(
    !SUPA_URL || !SERVICE_KEY || !FIXTURE_TRIP_ID || !AUTH_STATE,
    "set SUPABASE_SERVICE_ROLE_KEY, KEY_FLOWS_TRIP_ID and KEY_FLOWS_AUTH_STATE",
  );
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 150_000 });

  let admin: SupabaseClient;
  let ownerId: string;
  let tripId: string;

  const stored = async () => {
    const { data, error } = await admin.from("trips").select("start_date, end_date, itinerary").eq("id", tripId).single();
    if (error) throw error;
    return data as { start_date: string; end_date: string; itinerary: { date: string; activities: Stop[] }[] };
  };

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
      title: "E2E trip editing (safe to delete)",
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

  test("tapping a stop opens its editor; a longer stop makes room after it, and Undo puts the times back", async ({ page }) => {
    await openTrip(page, tripId);
    const castle = cardIn(page, 1, "e-d1a1");
    const lunch = cardIn(page, 1, "e-d1a2");
    await expect(lunch).toContainText("13:00");

    // A tap on the card, not on a button, opens its editor.
    await castle.getByText("Castelo de São Jorge").click();
    await castle.getByLabel("Duration").first().selectOption("240");
    await castle.getByRole("button", { name: /^save changes$/i }).click();

    // 10:00 for four hours runs past 13:00: lunch moves, and the page says so.
    await expect(page.getByText("The stop after it now starts later, to make room")).toBeVisible({ timeout: 10_000 });
    await expect(lunch).not.toContainText("13:00");
    await expect(cardIn(page, 1, "e-d1a3")).toContainText("19:00");

    await page.getByRole("button", { name: /^undo$/i }).last().click();
    await expect(lunch).toContainText("13:00", { timeout: 10_000 });
  });

  test("a new start time puts the stop in its place, and it stays after a reload", async ({ page }) => {
    await openTrip(page, tripId);
    const castle = cardIn(page, 1, "e-d1a1");
    await castle.getByRole("button", { name: /^edit activity$/i }).click();
    await castle.getByLabel("Start Time").first().fill("16:00");
    await saved(page, tripId, () => castle.getByRole("button", { name: /^save changes$/i }).click());

    const order = ["activity-card-e-d1a2", "activity-card-e-d1a1", "activity-card-e-d1a3"];
    await expect.poll(() => dayOrder(page, 1)).toEqual(order);
    await expect.poll(async () => (await stored()).itinerary[0].activities.map((a) => `${a.start_time} ${a.id}`)).toEqual([
      "13:00 e-d1a2",
      "16:00 e-d1a1",
      "19:00 e-d1a3",
    ]);

    await reopen(page);
    await expect.poll(() => dayOrder(page, 1)).toEqual(order);
    await expect(cardIn(page, 1, "e-d1a1")).toContainText("16:00");
  });

  test("a time typed while the stop before is still on is kept, noted, and Make room moves the next stop", async ({ page }) => {
    await openTrip(page, tripId);
    const lunch = cardIn(page, 1, "e-d1a2");
    await lunch.getByRole("button", { name: /^edit activity$/i }).click();
    await lunch.getByLabel("Start Time").first().fill("11:00");
    await lunch.getByRole("button", { name: /^save changes$/i }).click();

    // The castle runs 10:00 to 11:30: the 11:00 asked for stands, and the overlap shows.
    await expect(lunch).toContainText("11:00");
    const day1 = page.getByTestId("day-drop-list-1");
    const note = day1.getByRole("note");
    await expect(note).toContainText("Overlaps “Time Out Market lunch” by 30 min");

    await note.getByRole("button", { name: "Make room" }).click();
    await expect(day1.getByRole("note")).toHaveCount(0);
    await expect(lunch).not.toContainText("11:00");
    await expect(page.getByText("The stop after it now starts later, to make room")).toBeVisible();
    // The edit and the room made are both saved before the reload.
    await expect
      .poll(async () => (await stored()).itinerary[0].activities.find((a) => a.id === "e-d1a2")?.start_time, { timeout: 20_000 })
      .not.toBe("11:00");
    await expect.poll(async () => (await stored()).itinerary[0].activities.find((a) => a.id === "e-d1a2")?.start_time).not.toBe("13:00");

    await reopen(page);
    await expect(page.getByTestId("day-drop-list-1").getByRole("note")).toHaveCount(0);
    await expect(cardIn(page, 1, "e-d1a2")).not.toContainText("11:00");
  });

  test("a booked next stop is never moved to make room, and a fixed plan is marked", async ({ page }) => {
    await openTrip(page, tripId);
    const day2 = page.getByTestId("day-drop-list-2");
    const note = day2.getByRole("note");
    await expect(note).toContainText("Overlaps “Train to Porto” by 30 min");
    await expect(note.getByRole("button")).toHaveCount(0);
    await expect(cardIn(page, 2, "e-d2a2")).toContainText("10:30");
    await expect(cardIn(page, 2, "e-d2a3").getByLabel("Fixed plan")).toBeVisible();
    await expect(cardIn(page, 1, "e-d1a1").getByLabel("Fixed plan")).toHaveCount(0);
  });

  test("a stop added at a time lands in its place, with the length picked and no made-up place", async ({ page }) => {
    await openTrip(page, tripId);
    // One day shown, so its Add Activity is the only one.
    await page.locator('button[data-day="1"]').click();
    await expect(page.getByTestId("day-drop-list-2")).toHaveCount(0);

    await page.getByRole("button", { name: /^add activity$/i }).click();
    await page.getByRole("button", { name: /add custom activity/i }).click();
    const form = page.locator("form").filter({ hasText: /activity name/i });
    await form.getByLabel("Activity Name *").fill("Coffee at A Brasileira");
    await form.getByLabel("Start Time").fill("12:00");
    await form.getByLabel("Duration").selectOption("45");
    await saved(page, tripId, () => form.getByRole("button", { name: /^add activity$/i }).click());

    const cards = page.getByTestId("day-drop-list-1").locator('[data-testid^="activity-card-"]');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(1)).toContainText("Coffee at A Brasileira");
    await expect(cards.nth(1)).toContainText("12:00");
    await expect(cards.nth(1)).toContainText("45 min");

    await expect
      .poll(async () => {
        const added = (await stored()).itinerary[0].activities.find((a) => a.name === "Coffee at A Brasileira");
        return added ? { start: added.start_time, length: added.duration_minutes, place: added.coordinates ?? null } : null;
      })
      .toEqual({ start: "12:00", length: 45, place: null });
  });

  test("new dates move the days, add empty ones, and the assistant opens asking for them", async ({ page }) => {
    await openTrip(page, tripId);
    await page.getByRole("button", { name: /^change dates:/i }).click();
    await page.getByLabel("End", { exact: true }).fill(iso(34));
    await saved(page, tripId, () => page.getByRole("button", { name: "Change dates", exact: true }).click());

    await expect(page.getByText(/Days 4–5 are empty/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Ask the assistant" }).click();
    await expect(page.getByPlaceholder("Replace the Colosseum with something quieter...")).toHaveValue("Plan days 4 to 5 for me", {
      timeout: 15_000,
    });

    await expect
      .poll(async () => {
        const trip = await stored();
        return {
          end: trip.end_date,
          days: trip.itinerary.map((d) => `${d.date}:${d.activities.length}`),
        };
      })
      .toEqual({
        end: iso(34),
        days: [`${iso(30)}:3`, `${iso(31)}:3`, `${iso(32)}:1`, `${iso(33)}:0`, `${iso(34)}:0`],
      });

    await page.keyboard.press("Escape");
    await reopen(page);
    // The day itself; an empty day's drop strip only shows during a drag.
    await expect(page.locator("#trip-day-5")).toBeVisible({ timeout: 30_000 });
  });
});
