/**
 * The owner moves a trip through its status on the trip page: confirms a
 * planning trip, cancels one (asked first, with a way back out) and restores a
 * cancelled one. Each step shows on the page and lands in the database. A trip
 * that is over says so by its dates.
 *
 * Every test gets a trip of its own, removed afterwards. Needs the fixture
 * owner's session and service credentials:
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/trip-status.spec.ts --project=chromium
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

async function declineConsent(page: Page) {
  const btn = page.getByRole("button", { name: /essential only|solo essenziali|solo esenciales|apenas essenciais/i });
  try {
    await btn.waitFor({ state: "visible", timeout: 4000 });
    await btn.click();
  } catch {
    /* already decided */
  }
}

async function openTrip(page: Page, tripId: string) {
  // The share prompt and the assistant's first open are timed overlays.
  await page.addInitScript((id) => {
    localStorage.setItem(`share_prompt_dismissed:${id}`, "1");
    localStorage.setItem("mt_ai_assistant_seen", String(Date.now()));
  }, tripId);
  await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await declineConsent(page);
}

test.describe("trip status", () => {
  test.skip(
    !SUPA_URL || !SERVICE_KEY || !FIXTURE_TRIP_ID || !AUTH_STATE,
    "set SUPABASE_SERVICE_ROLE_KEY, KEY_FLOWS_TRIP_ID and KEY_FLOWS_AUTH_STATE",
  );
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 150_000 });

  let admin: SupabaseClient;
  let ownerId: string;
  let tripId: string;

  const statusInDb = async () => {
    const { data, error } = await admin.from("trips").select("status").eq("id", tripId).single();
    if (error) throw error;
    return data.status as string;
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
      title: "E2E trip status (safe to delete)",
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
            { id: "s-d1a1", name: "Cathedral visit", start_time: "10:00", duration_minutes: 90, type: "landmark", location: "Old town" },
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

  test("the owner confirms a planning trip", async ({ page }) => {
    await openTrip(page, tripId);
    // Confirming waits behind its chip; the card's own button follows it in the page.
    await page.getByTestId("trip-strip-confirm").click({ timeout: 60_000 });
    await expect(page.getByText("Ready to confirm your trip?")).toBeVisible();

    await page.getByRole("button", { name: "Confirm Trip", exact: true }).last().click();
    await expect(page.getByText("Trip confirmed")).toBeVisible({ timeout: 20_000 });
    await expect.poll(statusInDb, { timeout: 20_000 }).toBe("confirmed");
    await expect(page.getByText("Ready to confirm your trip?")).toHaveCount(0);
    await expect(page.getByTestId("trip-strip-confirm")).toHaveCount(0);
  });

  test("a trip that is over says so, and is not offered for confirming", async ({ page }) => {
    const { error } = await admin.from("trips").update({ start_date: iso(-5), end_date: iso(-3) }).eq("id", tripId);
    if (error) throw error;

    await openTrip(page, tripId);
    await expect(page.getByText("Memories", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("trip-strip-confirm")).toHaveCount(0);
    expect(await statusInDb()).toBe("planning");
  });

  test("an archived trip leaves My Trips, waits under Show archived and can be restored", async ({ page }) => {
    const archivedInDb = async () => {
      const { data, error } = await admin.from("trips").select("is_archived").eq("id", tripId).single();
      if (error) throw error;
      return data.is_archived as boolean;
    };
    await page.goto("/en/trips", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await declineConsent(page);
    const card = page.locator(`a[href$="/trips/${tripId}"]`);
    await expect(card).toBeVisible({ timeout: 60_000 });

    await card.getByRole("button", { name: "Trip actions" }).click();
    await page.getByRole("menuitem", { name: "Archive Trip" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive Trip" }).click();
    await expect.poll(archivedInDb, { timeout: 20_000 }).toBe(true);
    await expect(card).toHaveCount(0, { timeout: 20_000 });

    await page.getByRole("button", { name: /Show archived/ }).click();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Trip actions" }).click();
    await page.getByRole("menuitem", { name: "Restore from Archive" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Restore from Archive" }).click();
    await expect.poll(archivedInDb, { timeout: 20_000 }).toBe(false);
    await expect(card).toBeVisible({ timeout: 20_000 });
  });

  test("cancelling asks first, and a cancelled trip can be restored", async ({ page }) => {
    await openTrip(page, tripId);
    const cancelTrip = page.getByRole("button", { name: "Cancel Trip", exact: true });
    await expect(cancelTrip).toBeVisible({ timeout: 60_000 });

    // Keeping the trip closes the question and changes nothing.
    await cancelTrip.click();
    const dialog = page.getByRole("dialog", { name: "Cancel this trip?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep trip" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await statusInDb()).toBe("planning");

    await cancelTrip.click();
    await page.getByRole("dialog", { name: "Cancel this trip?" }).getByRole("button", { name: "Cancel trip", exact: true }).click();
    await expect(page.getByText("Trip cancelled")).toBeVisible({ timeout: 20_000 });
    await expect.poll(statusInDb, { timeout: 20_000 }).toBe("cancelled");
    await expect(page.getByText(/This trip is cancelled/)).toBeVisible();

    await page.getByRole("button", { name: "Restore Trip", exact: true }).click();
    await expect(page.getByText("Trip restored")).toBeVisible({ timeout: 20_000 });
    await expect.poll(statusInDb, { timeout: 20_000 }).toBe("planning");
    await expect(page.getByText("Ready to confirm your trip?")).toBeVisible();
  });
});
