/**
 * A saved trip's places to eat, on a real page with a real row: the owner's first
 * open asks for the check, and the page says what it found. A later open reads
 * what was stored, and doesn't ask again. Google's part is stubbed, since this job
 * has no key. Moves the fixture trip's dates with the service role, and restores them.
 *
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/places-checked.spec.ts --project=chromium
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PLACES_TO_EAT_CHECKED_AT, PLACES_TO_EAT_RESULT } from "@/lib/places/kept-trip";
import { envVar } from "./env";

const SUPA_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;
const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;

function inDays(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

test.describe("places checked on a saved trip", () => {
  test.skip(!SUPA_URL || !SERVICE_KEY || !TRIP_ID || !AUTH_STATE, "set SUPABASE_SERVICE_ROLE_KEY, KEY_FLOWS_TRIP_ID and KEY_FLOWS_AUTH_STATE");
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 120_000 });

  test("the first open asks and says what it found, and a later one reads it back", async ({ page }) => {
    const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: original, error } = await admin
      .from("trips")
      .select("start_date, end_date, trip_meta")
      .eq("id", TRIP_ID!)
      .single();
    expect(error, error?.message).toBeNull();

    const meta = { ...((original!.trip_meta as Record<string, unknown>) ?? {}) };
    delete meta[PLACES_TO_EAT_CHECKED_AT];
    delete meta[PLACES_TO_EAT_RESULT];
    const set = async (tripMeta: Record<string, unknown>) => {
      const { error: upErr } = await admin
        .from("trips")
        .update({ start_date: inDays(10), end_date: inDays(12), trip_meta: tripMeta })
        .eq("id", TRIP_ID!);
      expect(upErr, upErr?.message).toBeNull();
    };

    let asked = 0;
    await page.route(`**/api/trips/${TRIP_ID}/places-to-eat`, async (route) => {
      asked += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "checked", changes: [], note: { checkedAt: new Date().toISOString(), checked: 4, changed: 0 } }),
      });
    });

    try {
      await set(meta);
      await page.goto(`/trips/${TRIP_ID}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText(/4 places to eat checked on Google Maps/)).toBeVisible({ timeout: 30_000 });
      expect(asked).toBe(1);

      asked = 0;
      await set({ ...meta, [PLACES_TO_EAT_CHECKED_AT]: new Date().toISOString(), [PLACES_TO_EAT_RESULT]: { checked: 3, changed: 1 } });
      await page.goto(`/trips/${TRIP_ID}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText(/3 places to eat checked on Google Maps/)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/We changed 1 that wasn't open/)).toBeVisible();
      await page.waitForTimeout(1500);
      expect(asked).toBe(0);
    } finally {
      await admin
        .from("trips")
        .update({ start_date: original!.start_date, end_date: original!.end_date, trip_meta: original!.trip_meta })
        .eq("id", TRIP_ID!);
    }
  });
});
