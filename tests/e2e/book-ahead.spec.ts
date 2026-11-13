/**
 * "Book ahead" on the owner's upcoming trip: the stops the plan says need a
 * booking, by date, with a link to book from, and a "Booked" tick the trip keeps
 * through a reload.
 *
 * Every test gets a trip of its own, removed afterwards. Needs the fixture
 * owner's session and service credentials:
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/book-ahead.spec.ts --project=chromium
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

const stop = (id: string, name: string, start_time: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  start_time,
  duration_minutes: 90,
  type: "landmark",
  location: "Barcelona",
  booking_required: false,
  ...extra,
});

test.describe("Book ahead on an upcoming trip", () => {
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
      title: "E2E book ahead (safe to delete)",
      description: "Automated E2E fixture. Safe to delete.",
      start_date: iso(40),
      end_date: iso(41),
      status: "planning",
      visibility: "private",
      itinerary: [
        {
          day_number: 1,
          date: iso(40),
          title: "Gaudí",
          activities: [
            stop("ba-d1a1", "Breakfast at the market", "08:30"),
            stop("ba-d1a2", "Sagrada Família", "11:00", { booking_required: true, official_website: "https://sagradafamilia.org" }),
          ],
        },
        {
          day_number: 2,
          date: iso(41),
          title: "Evening",
          activities: [stop("ba-d2a1", "Flamenco show", "21:00", { booking_required: true })],
        },
      ],
      trip_meta: { destination: "Barcelona", e2e_fixture: true },
    });
    if (error) throw error;
  });

  test.afterEach(async () => {
    if (tripId) await admin.from("trips").delete().eq("id", tripId);
  });

  test("lists what needs booking with a link, and keeps a tick through a reload", async ({ page }) => {
    await openTrip(page, tripId);
    // The plan comes first: the list waits behind its chip, which carries the count.
    const chip = page.getByTestId("trip-strip-book");
    await expect(chip).toContainText("0 of 2 booked", { timeout: 60_000 });
    const list = page.getByTestId("book-ahead");
    await expect(list).toBeHidden();
    await chip.click();
    await expect(list).toBeVisible();
    await expect(list.getByText("0 of 2 booked")).toBeVisible();
    const boxes = list.getByRole("checkbox");
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).toHaveAccessibleName("Booked: Sagrada Família");
    await expect(boxes.nth(1)).toHaveAccessibleName("Booked: Flamenco show");
    await expect(list.getByRole("link", { name: "Book online" })).toHaveAttribute("href", "https://sagradafamilia.org");
    await expect(list.getByText("Breakfast at the market")).toHaveCount(0);

    await list.getByRole("checkbox", { name: "Booked: Flamenco show" }).check();
    await expect(list.getByText("1 of 2 booked")).toBeVisible();
    await expect(chip).toContainText("1 of 2 booked");
    await expect
      .poll(async () => {
        const { data } = await admin.from("trips").select("trip_meta").eq("id", tripId).single();
        return (data?.trip_meta as { booked_ids?: string[] } | null)?.booked_ids;
      }, { timeout: 20_000 })
      .toEqual(["ba-d2a1"]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trip-strip-book")).toContainText("1 of 2 booked", { timeout: 60_000 });
    await page.getByTestId("trip-strip-book").click();
    await expect(page.getByRole("checkbox", { name: "Booked: Flamenco show" })).toBeChecked();

    // The plan comes first: on a phone the first stop is on the first screen, under the row of chips
    // and above the tab bar. As cards, what the chips hold used to fill two screens before it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    const firstStop = page.getByText("Breakfast at the market", { exact: true }).first();
    await expect(firstStop).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("trip-strip")).toBeVisible();
    // Once it has drawn, the page asks whether the trip was sent to anyone. For one that was not,
    // the answer brings a nudge to send it: the first screen is measured only after the nudge has
    // arrived, and the nudge sits under the days.
    const nudge = page.getByText("Going with friends?", { exact: false });
    await expect(nudge).toBeVisible({ timeout: 30_000 });
    const lastStop = page.getByText("Flamenco show", { exact: true }).filter({ visible: true }).first();
    expect((await nudge.boundingBox())!.y, "the nudge sits under the last stop").toBeGreaterThan((await lastStop.boundingBox())!.y);
    // Measured once the page has settled: its fonts in and nothing more on the wire.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    // A reload keeps the scroll position, and a page scrolled down shows the stop higher than a
    // first visit does: the page goes back to its top before it is measured.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const box = await firstStop.boundingBox();
    expect(box, "the first stop has a place on the page").not.toBeNull();
    const tabBar = await page.getByTestId("mobile-bottom-nav").boundingBox();
    expect(tabBar, "the tab bar has a place on the page").not.toBeNull();
    // What stands between the header and the days, named in the message if the stop is too low.
    const above = await page.evaluate(() =>
      [...document.querySelectorAll("main > *")]
        .map((el) => ({ name: el.getAttribute("data-testid") ?? el.tagName.toLowerCase(), box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.height > 0 && box.top < 900)
        .map(({ name, box }) => name + " " + Math.round(box.top) + "-" + Math.round(box.bottom))
        .join(", "),
    );
    expect(box!.y + box!.height, "the first stop's name ends well above the tab bar of the first screen (" + above + ")").toBeLessThan(tabBar!.y - 40);
    // The line on editing in place waits under the first day.
    const editLine = page.getByText("your changes save automatically", { exact: false });
    await expect(editLine).toBeVisible();
    expect((await editLine.boundingBox())!.y, "the editing line sits under the first stop").toBeGreaterThan(box!.y);

    // Nothing floats on that first screen: the floating assistant button waits until the bar's own
    // assistant button has scrolled away, and leaves again when that one is back.
    const floating = page.getByTitle("AI Trip Assistant");
    const inBar = page.getByRole("button", { name: "Edit with AI" });
    await expect(inBar).toBeInViewport();
    await expect(floating).toBeHidden();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await expect(inBar).not.toBeInViewport();
    await expect(floating).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(inBar).toBeInViewport();
    await expect(floating).toBeHidden();
  });
});
