/**
 * What the trip page's More menu offers the owner. A calendar comes one way:
 * Export's calendar file, made in the browser. The server's "Add to Calendar"
 * is switched off in production, and the suite builds with production's switches.
 *
 * Every test gets a trip of its own, removed afterwards. Needs the fixture
 * owner's session and service credentials:
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/trip-menu.spec.ts --project=chromium
 */
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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

async function openTrip(page: Page, tripId: string) {
  // The share prompt and the assistant's first open are timed overlays.
  await page.addInitScript((id) => {
    localStorage.setItem(`share_prompt_dismissed:${id}`, "1");
    localStorage.setItem("mt_ai_assistant_seen", String(Date.now()));
  }, tripId);
  await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const essentialOnly = page.getByRole("button", { name: /essential only/i });
  await essentialOnly
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => essentialOnly.click())
    .catch(() => {});
}

test.describe("the trip's More menu", () => {
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
      title: "E2E trip menu (safe to delete)",
      description: "Automated E2E fixture. Safe to delete.",
      start_date: iso(40),
      end_date: iso(41),
      status: "planning",
      visibility: "private",
      itinerary: [
        {
          day_number: 1,
          date: iso(40),
          title: "Old town",
          activities: [
            { id: "m-d1a1", name: "Cathedral visit", start_time: "10:00", duration_minutes: 90, type: "landmark", location: "Old town" },
          ],
        },
      ],
      trip_meta: { destination: "Porto", e2e_fixture: true },
    });
    if (error) throw error;
  });

  test.afterEach(async () => {
    if (tripId) await admin.from("trips").delete().eq("id", tripId);
  });

  test("offers the calendar once, as Export's calendar file, and the file holds the trip", async ({ page }) => {
    await openTrip(page, tripId);
    await page.getByRole("button", { name: "More", exact: true }).click({ timeout: 60_000 });
    const menu = page.getByRole("menu", { name: "More" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "Export" })).toBeVisible();
    await expect(menu.getByText("Add to Calendar", { exact: true })).toHaveCount(0);

    await menu.getByRole("button", { name: "Export" }).click();
    const calendarFile = menu.getByRole("button", { name: /Calendar File \(\.ics\)/ });
    await expect(calendarFile).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), calendarFile.click()]);
    expect(download.suggestedFilename()).toMatch(/\.ics$/);
    const ics = await readFile((await download.path())!, "utf8");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("Cathedral visit");
  });
});
