/**
 * A pre-trip reminder's one question, answered from its link on a real page and a
 * real database, signed out as most readers are: the tapped answer is kept as the
 * page opens, against the trip and the owner the link names, and a note with a yes
 * to being written to adds a second row with no address copied into it. A link that
 * names no trip, or an answer that isn't one, lands on the expired page and keeps
 * nothing. Links are signed with this job's secret, as the reminders sign them.
 * Removes its rows before and after.
 *
 *   KEY_FLOWS_TRIP_ID=<manifest tripId> npx playwright test tests/e2e/what-you-need.spec.ts --project=chromium
 */
import { test, expect } from "@playwright/test";
import { envVar, readManifest, serviceCreds, serviceDb } from "./env";

// The server signs with the first of these it has, so the test does too.
const SECRET = envVar("FEEDBACK_LINK_SECRET") || envVar("EMAIL_UNSUBSCRIBE_SECRET");
const TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

test.describe("what you still need, answered from a reminder", () => {
  const manifest = readManifest();
  const { url, key } = serviceCreds();
  test.skip(
    !SECRET || !TRIP_ID || !manifest || !url || !key,
    "set FEEDBACK_LINK_SECRET, KEY_FLOWS_TRIP_ID and SUPABASE_SERVICE_ROLE_KEY, and seed the fixtures"
  );
  test.describe.configure({ timeout: 90_000 });

  test("the tap is kept as the page opens, and a note with a yes to writing back adds to it", async ({ browser }) => {
    process.env.FEEDBACK_LINK_SECRET = SECRET;
    const { buildNeedUrl, signFeedbackToken } = await import("@/lib/feedback/token");
    const owner = manifest!.users.owner.id;
    const db = await serviceDb();
    const answers = async () => {
      const { data, error } = await db
        .from("user_feedback")
        .select("user_id, source, open_to_chat, contact_email, extra, created_at")
        .eq("extra->>trip_id", TRIP_ID!)
        .order("created_at", { ascending: true });
      expect(error, error?.message).toBeNull();
      return data ?? [];
    };
    const clear = async () => {
      const { error } = await db.from("user_feedback").delete().eq("extra->>trip_id", TRIP_ID!);
      expect(error, error?.message).toBeNull();
    };
    await clear();

    // Signed out: the reminder is read in a mail app, not in a signed-in tab.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const kept = page.waitForResponse((r) => r.url().endsWith("/api/feedback") && r.request().method() === "POST");
      await page.goto(buildNeedUrl(owner, TRIP_ID!, "stay", "pack_early_14d", "en", BASE_URL));
      const response = await kept;
      expect(await response.json()).toMatchObject({ saved: true });

      await expect(page.getByRole("heading", { name: "What you still need for this trip" })).toBeVisible();
      await expect(page.getByText("Where to stay", { exact: true })).toBeVisible();
      await expect(page.getByText("Noted, thank you.")).toBeVisible();

      const first = await answers();
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        user_id: owner,
        source: "email_link",
        open_to_chat: false,
        contact_email: null,
        extra: { trip_id: TRIP_ID, need: "stay" },
      });

      await page.getByLabel("Anything else you need for this trip? (optional)").fill("Somewhere near the station");
      await page.getByLabel("You can write back to me about this").check();
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();

      const both = await answers();
      expect(both).toHaveLength(2);
      expect(both[1]).toMatchObject({
        user_id: owner,
        open_to_chat: true,
        contact_email: null,
        extra: { trip_id: TRIP_ID, need: "stay", need_note: "Somewhere near the station" },
      });

      // Links that can't be answered keep nothing.
      const noTrip = new URL(buildNeedUrl(owner, TRIP_ID!, "book", "weather_3d", "en", BASE_URL));
      noTrip.searchParams.set("t", signFeedbackToken(owner));
      const notAnAnswer = new URL(buildNeedUrl(owner, TRIP_ID!, "book", "weather_3d", "en", BASE_URL));
      notAnAnswer.searchParams.set("need", "perhaps");
      for (const link of [noTrip, notAnAnswer]) {
        await page.goto(link.toString());
        await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
      }
      expect(await answers()).toHaveLength(2);
    } finally {
      await context.close();
      await clear();
    }
  });
});
