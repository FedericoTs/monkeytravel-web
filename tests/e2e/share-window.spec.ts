/**
 * The share window on a trip, as its owner, against the real routes: turning the
 * link on, making an invite link, and moving between the tabs without losing it.
 *
 * Every test gets a trip of its own, removed afterwards. Needs the fixture owner's
 * session and service credentials:
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/share-window.spec.ts --project=chromium
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

test.describe("the share window", () => {
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
      title: "E2E share window (safe to delete)",
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
            { id: "s-d1a1", name: "Cathedral visit", start_time: "10:00", duration_minutes: 90, type: "landmark", location: "Porto" },
          ],
        },
      ],
      trip_meta: { destination: "Porto", e2e_fixture: true },
    });
    if (error) throw error;
  });

  test.afterEach(async () => {
    if (!tripId) return;
    await admin.from("trip_invites").delete().eq("trip_id", tripId);
    await admin.from("trips").delete().eq("id", tripId);
  });

  test("the owner turns the link on, and an invite link survives moving between the tabs", async ({ page }) => {
    await openTrip(page, tripId);
    await page.getByRole("button", { name: "Share", exact: true }).first().click({ timeout: 60_000 });
    const dialog = page.getByRole("dialog", { name: "Share & Invite" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Enable Sharing" }).click();
    const publicLink = dialog.getByLabel("Public Link");
    await expect(publicLink).toHaveValue(/\/shared\//, { timeout: 20_000 });

    const inviteTab = dialog.getByRole("button", { name: /Invite to Collaborate/ });
    await inviteTab.click();
    await dialog.getByRole("button", { name: "More invite options" }).click();
    await dialog.getByRole("button", { name: "Generate Invite Link" }).click();
    const inviteLink = dialog.getByLabel("Invite link");
    await expect(inviteLink).toHaveValue(/\/invite\//, { timeout: 20_000 });
    const made = await inviteLink.inputValue();

    await dialog.getByRole("button", { name: /Crew Voting Link/ }).click();
    await expect(publicLink).toBeVisible();
    await expect(inviteLink).toHaveCount(0);
    await inviteTab.click();
    await expect(inviteLink).toHaveValue(made);

    const { data, error } = await admin.from("trip_invites").select("role, is_active").eq("trip_id", tripId);
    if (error) throw error;
    expect(data).toEqual([{ role: "editor", is_active: true }]);

    await dialog.getByRole("button", { name: "Close share dialog" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("opening the window again drops the old invite link", async ({ page }) => {
    await openTrip(page, tripId);
    const share = page.getByRole("button", { name: /^(Share|Shared)$/ }).first();
    await share.click({ timeout: 60_000 });
    const dialog = page.getByRole("dialog", { name: "Share & Invite" });
    await dialog.getByRole("button", { name: /Invite to Collaborate/ }).click();
    await dialog.getByRole("button", { name: "More invite options" }).click();
    await dialog.getByRole("button", { name: "Generate Invite Link" }).click();
    await expect(dialog.getByLabel("Invite link")).toHaveValue(/\/invite\//, { timeout: 20_000 });

    await dialog.getByRole("button", { name: "Close share dialog" }).click();
    await expect(dialog).toHaveCount(0);
    await share.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Invite to Collaborate/ }).click();
    await expect(dialog.getByLabel("Invite link")).toHaveCount(0);
  });
});
