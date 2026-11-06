/**
 * The Waiting Room on the signed-in home, against a real build and a real
 * database: the page's own read of the trip, then what the card says at each
 * distance from departure. Moves the fixture trip's dates with the service role,
 * and restores them.
 *
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/waiting-room.spec.ts --project=chromium
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { inWaitingRoom } from "@/lib/trips/waiting-room";
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

const ITINERARY = [
  {
    day_number: 1,
    title: "First day",
    activities: [{ id: "w-1", name: "São Jorge Castle", start_time: "10:00", duration_minutes: 90, type: "landmark", location: "Alfama" }],
  },
];

test.describe("the Waiting Room", () => {
  test.skip(!SUPA_URL || !SERVICE_KEY || !TRIP_ID || !AUTH_STATE, "set SUPABASE_SERVICE_ROLE_KEY, KEY_FLOWS_TRIP_ID and KEY_FLOWS_AUTH_STATE");
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 150_000 });

  test("counts down to the trip, and what sits under it changes with the distance", async ({ page }) => {
    const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: original, error } = await admin
      .from("trips")
      .select("user_id, start_date, end_date, itinerary, trip_meta")
      .eq("id", TRIP_ID!)
      .single();
    expect(error, error?.message).toBeNull();
    const room = page.getByTestId("waiting-room");

    const homeWith = async (start: number, end: number, meta: Record<string, unknown> = {}) => {
      const { error: upErr } = await admin
        .from("trips")
        .update({
          start_date: inDays(start),
          end_date: inDays(end),
          itinerary: ITINERARY,
          trip_meta: {
            ...((original!.trip_meta as Record<string, unknown>) ?? {}),
            highlights: ["Tram 28 through Alfama"],
            packing_suggestions: ["Rain jacket"],
            ...meta,
          },
        })
        .eq("id", TRIP_ID!);
      expect(upErr, upErr?.message).toBeNull();
      await page.goto("/trips", { waitUntil: "domcontentloaded" });
    };

    try {
      await homeWith(45, 48);

      // One account in ten sees nothing, as a holdout, and keeps its usual page.
      if (!inWaitingRoom(original!.user_id as string)) {
        await expect(page.getByText("E2E Fixture Trip").first()).toBeVisible();
        await expect(room).toHaveCount(0);
        return;
      }

      await expect(room).toContainText("E2E Fixture Trip");
      await expect(room).toContainText("45");
      await expect(room).toContainText("days to go");
      await expect(room).toContainText("While you wait");
      await expect(room).toContainText("Tram 28 through Alfama");

      await homeWith(20, 23);
      await expect(room).toContainText("20");
      await expect(room).toContainText("Worth sorting now");
      await expect(room).toContainText("Rain jacket");
      await expect(room).not.toContainText("Tram 28");

      await homeWith(3, 6);
      await expect(room).toContainText("Before you go");
      await expect(room).toContainText("Day one starts with São Jorge Castle.");

      await homeWith(30, 33, { dates_pencilled: { start: inDays(30), end: inDays(33) } });
      await expect(room).toContainText("These dates are a placeholder");
      await expect(room).not.toContainText("to go");

      await homeWith(-1, 1);
      await expect(room).toContainText("Day 2 of 3");
      await expect(room).not.toContainText("to go");
      await room.getByRole("link", { name: "Open today's plan" }).click();
      await expect(page).toHaveURL(new RegExp(`/trips/${TRIP_ID}`));
    } finally {
      await admin
        .from("trips")
        .update({
          start_date: original!.start_date,
          end_date: original!.end_date,
          itinerary: original!.itinerary,
          trip_meta: original!.trip_meta,
        })
        .eq("id", TRIP_ID!);
    }
  });
});
