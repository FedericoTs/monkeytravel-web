/**
 * "Regenerate with AI" on an activity card, as a solo owner (the ambient
 * editor): a failure says so in a toast, with its own message at the monthly
 * limit, and leaves the activity; a success replaces it in place. The
 * regenerate call is answered by the test, so no model runs.
 *
 * Each test creates its own throwaway trip for the e2e owner and deletes it
 * afterwards, as move-between-days does. Needs the owner's storage state and
 * the fixture trip id (only to find the owner's user id):
 *
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *   BASE_URL=http://localhost:3001 \
 *     npx playwright test tests/e2e/regenerate-activity.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { visibleWithin } from "./helpers";

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

const ORIGINAL = "Castelo de São Jorge";

function itinerary() {
  return [
    {
      day_number: 1,
      date: iso(30),
      title: "Alfama",
      activities: [
        { id: "r-d1a1", name: ORIGINAL, start_time: "10:00", duration_minutes: 90, type: "landmark", location: "Alfama", address: "Alfama, Lisboa", coordinates: { lat: 38.7139, lng: -9.1335 } },
        { id: "r-d1a2", name: "Time Out Market lunch", start_time: "13:00", duration_minutes: 90, type: "restaurant", location: "Cais do Sodré", address: "Av. 24 de Julho, Lisboa", coordinates: { lat: 38.707, lng: -9.1459 } },
      ],
    },
  ];
}

const card = (page: Page) => page.getByTestId("day-drop-list-1").getByTestId("activity-card-r-d1a1");

async function openTrip(page: Page, tripId: string) {
  await page.addInitScript((id) => {
    localStorage.setItem(`share_prompt_dismissed:${id}`, "1");
    localStorage.setItem("mt_ai_assistant_seen", String(Date.now()));
  }, tripId);
  await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const consent = page.getByRole("button", { name: /essential only/i });
  if (await visibleWithin(consent, 4000)) await consent.click();
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
}

/** Answer the regenerate call with `status` and `body`, then press "Regenerate with AI". */
async function regenerate(page: Page, status: number, body: unknown) {
  await page.route("**/api/ai/regenerate-activity", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
  await card(page).getByRole("button", { name: /more actions/i }).click();
  await page.getByRole("menuitem", { name: /regenerate with ai/i }).click();
}

test.describe("Regenerate an activity", () => {
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
      title: "E2E regenerate-activity (safe to delete)",
      description: "Automated E2E fixture. Safe to delete.",
      start_date: iso(30),
      end_date: iso(30),
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

  test("at the monthly limit it says so, and the activity stays", async ({ page }) => {
    await openTrip(page, tripId);
    await regenerate(page, 429, { error: "Usage limit reached" });
    await expect(page.getByText(/reached this month's regeneration limit\. The activity is unchanged/i)).toBeVisible();
    await expect(card(page)).toContainText(ORIGINAL);
  });

  test("a failure says so, and the activity stays", async ({ page }) => {
    await openTrip(page, tripId);
    await regenerate(page, 500, { error: "Failed to regenerate activity. Please try again." });
    await expect(page.getByText(/failed to regenerate activity/i).first()).toBeVisible();
    await expect(card(page)).toContainText(ORIGINAL);
  });

  test("a regenerated activity replaces the card in place", async ({ page }) => {
    await openTrip(page, tripId);
    await regenerate(page, 200, {
      activity: { name: "Miradouro da Graça", type: "landmark", start_time: "10:00", duration_minutes: 60, location: "Graça", description: "A viewpoint over the old town." },
    });
    await expect(card(page)).toContainText("Miradouro da Graça");
    await expect(page.getByText(/failed to regenerate|regeneration limit/i)).toHaveCount(0);
  });
});
