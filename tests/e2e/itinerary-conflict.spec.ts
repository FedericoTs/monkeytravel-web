/**
 * A save refused because the trip changed somewhere else (a trip mate, another
 * tab): the page says so, keeps the planner's edit, and lets them choose.
 * "Load latest version" shows the newer plan and drops the edit; "Keep my
 * version" saves the edit over it.
 *
 * The other writer is the service client renaming an activity, which moves
 * itinerary_version as any save does. Every test gets a trip of its own, a
 * few weeks out (a solo owner's edits save themselves), removed afterwards.
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/itinerary-conflict.spec.ts --project=chromium
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

const ELSEWHERE = "Belém, changed in another tab";

function iso(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

type Day = { day_number: number; activities: { id: string; name: string }[] };

function itinerary() {
  return [
    {
      day_number: 1,
      date: iso(30),
      title: "Alfama",
      activities: [
        { id: "c-d1a1", name: "Castelo de São Jorge", start_time: "10:00", duration_minutes: 90, type: "landmark", location: "Alfama" },
        { id: "c-d1a2", name: "Time Out Market lunch", start_time: "13:00", duration_minutes: 90, type: "restaurant", location: "Cais do Sodré" },
      ],
    },
    {
      day_number: 2,
      date: iso(31),
      title: "Belém",
      activities: [{ id: "c-d2a1", name: "Jerónimos Monastery", start_time: "09:30", duration_minutes: 90, type: "landmark", location: "Belém" }],
    },
    {
      day_number: 3,
      date: iso(32),
      title: "Sintra",
      activities: [{ id: "c-d3a1", name: "Pena Palace", start_time: "10:00", duration_minutes: 150, type: "landmark", location: "Sintra" }],
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

async function openTrip(page: Page, tripId: string) {
  await page.addInitScript((id) => {
    localStorage.setItem(`share_prompt_dismissed:${id}`, "1");
    localStorage.setItem("mt_ai_assistant_seen", String(Date.now()));
  }, tripId);
  await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await declineConsent(page);
  await expect(cardIn(page, 1, "c-d1a2")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("activity-actions").first()).toBeVisible({ timeout: 15_000 });
}

/** The planner's edit: lunch moves from day 1 to day 3. */
async function moveLunchToDay3(page: Page) {
  await cardIn(page, 1, "c-d1a2").getByRole("button", { name: /more actions/i }).click();
  await page.getByRole("menuitem", { name: /move to another day/i }).click();
  await page.getByTestId("move-to-day-3").click();
  await expect(cardIn(page, 3, "c-d1a2")).toBeVisible({ timeout: 10_000 });
}

test.describe("a save refused because the trip changed elsewhere", () => {
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
    const { data, error } = await admin.from("trips").select("itinerary").eq("id", tripId).single();
    if (error) throw error;
    return data.itinerary as Day[];
  };
  const idsByDay = (days: Day[]) => days.map((d) => d.activities.map((a) => a.id));
  const nameOf = (days: Day[], id: string) => days.flatMap((d) => d.activities).find((a) => a.id === id)?.name;

  /** Another writer renames day 2's activity, after this page loaded. */
  async function changeElsewhere() {
    const days = await stored();
    days[1].activities[0].name = ELSEWHERE;
    const { error } = await admin.from("trips").update({ itinerary: days }).eq("id", tripId);
    if (error) throw error;
  }

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
      title: "E2E itinerary conflict (safe to delete)",
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

  test("says so and keeps the edit unsaved; Load latest version shows the newer plan", async ({ page }) => {
    await openTrip(page, tripId);
    await changeElsewhere();
    await moveLunchToDay3(page);

    const banner = page.getByTestId("itinerary-conflict");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    let days = await stored();
    expect(idsByDay(days)[0], "the refused save wrote nothing").toEqual(["c-d1a1", "c-d1a2"]);
    expect(nameOf(days, "c-d2a1")).toBe(ELSEWHERE);

    await page.getByTestId("conflict-load-latest").click();
    await expect(banner).toHaveCount(0, { timeout: 20_000 });
    await expect(cardIn(page, 1, "c-d1a2")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(ELSEWHERE)).toBeVisible();
    days = await stored();
    expect(idsByDay(days)[0]).toEqual(["c-d1a1", "c-d1a2"]);
    expect(nameOf(days, "c-d2a1")).toBe(ELSEWHERE);
  });

  test("Keep my version saves the edit over the newer one", async ({ page }) => {
    await openTrip(page, tripId);
    await changeElsewhere();
    await moveLunchToDay3(page);

    const banner = page.getByTestId("itinerary-conflict");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("conflict-keep-mine").click();
    await expect(banner).toHaveCount(0, { timeout: 20_000 });

    await expect.poll(async () => idsByDay(await stored()), { timeout: 30_000 }).toEqual([["c-d1a1"], ["c-d2a1"], ["c-d3a1", "c-d1a2"]]);
    expect(nameOf(await stored(), "c-d2a1")).toBe("Jerónimos Monastery");
  });
});
