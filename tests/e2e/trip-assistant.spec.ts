/**
 * The trip page's two ways of asking the AI, as the owner: the assistant ("Edit
 * with AI") and the concierge. What would reach the model is answered by the test,
 * so no model runs. Saving a change and undoing it go through the real routes, and
 * the trip's row is read back.
 *
 * Every test gets a trip of its own, a few weeks out, removed afterwards. Needs the
 * fixture owner's session, service credentials and a build with the concierge on:
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/trip-assistant.spec.ts --project=chromium
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PendingChange } from "@/lib/ai/assistant/pending-change";
import type { Activity, ItineraryDay } from "@/types";
import { envVar } from "./env";

const SUPA_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const FIXTURE_TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;
const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;

const CATHEDRAL = "Cathedral visit";
const LUNCH = "Riverside lunch";
const BRIDGE = "Bridge walk";
const GARDEN = "Crystal Palace gardens";
const CELLAR = "Port wine cellar";
const AS_STORED = [CATHEDRAL, LUNCH, BRIDGE];

function iso(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function activity(id: string, name: string, start_time: string): Activity {
  return {
    id,
    name,
    start_time,
    time_slot: "morning",
    duration_minutes: 60,
    type: "landmark",
    description: "Fixture activity.",
    location: "Porto",
    tips: [],
    booking_required: false,
  };
}

function storedDays(): ItineraryDay[] {
  return [
    { day_number: 1, date: iso(40), title: "Old town", activities: [activity("t-d1a1", CATHEDRAL, "10:00"), activity("t-d1a2", LUNCH, "13:00")] },
    { day_number: 2, date: iso(41), title: "Across the river", activities: [activity("t-d2a1", BRIDGE, "11:00")] },
  ];
}

/** The first day with a calmer morning, as a turn of the assistant prepares it. */
function calmerDayOne(): PendingChange {
  const [dayOne] = storedDays();
  return {
    type: "apply_draft",
    days: [{ ...dayOne, theme: "A calmer morning", activities: [activity("t-d1a1-new", GARDEN, "10:00"), dayOne.activities[1]] }],
    changedDayNumbers: [1],
    reason: "A quieter start.",
  };
}

/** One more day after the last, as a turn of the assistant prepares it. */
function aThirdDay(): PendingChange {
  return {
    type: "apply_draft",
    days: [{ day_number: 3, date: iso(42), title: "Douro", activities: [activity("t-d3a1", GARDEN, "10:00")] }],
    changedDayNumbers: [3],
    newEndDate: iso(42),
    previousEndDate: iso(41),
  };
}

const answered = (content: string) => ({
  message: { role: "assistant", content, timestamp: new Date().toISOString() },
  pendingChange: null,
  model: "stub",
  usage: { remaining: 9 },
});

const prepared = (pendingChange: PendingChange) => ({
  message: {
    role: "assistant",
    content: "Here is a calmer plan.",
    action: { type: pendingChange.type, applied: false, pending: true },
    pendingNote: "Not saved yet: tap Save to my trip.",
    timestamp: new Date().toISOString(),
  },
  pendingChange,
  model: "stub",
  usage: { remaining: 9 },
});

/** Answers the assistant's turns in this order, staying on the last; returns what was asked. */
async function answerTurns(page: Page, ...replies: { status?: number; body: unknown }[]) {
  const asked: Array<{ tripId?: string; message?: string; itinerary?: ItineraryDay[]; waiting?: { days?: ItineraryDay[] } }> = [];
  await page.route("**/api/ai/assistant", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    asked.push(route.request().postDataJSON());
    const reply = replies[Math.min(asked.length, replies.length) - 1];
    await route.fulfill({ status: reply.status ?? 200, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  return asked;
}

/** Answers the concierge's questions with these streams in this order, staying on the last; returns what was asked. */
async function answerConcierge(page: Page, ...streams: unknown[][]) {
  const asked: Array<{ tripId?: string; question?: string; clientToday?: string; itineraryVersion?: number }> = [];
  await page.route("**/api/ai/concierge", async (route) => {
    asked.push(route.request().postDataJSON());
    const frames = streams[Math.min(asked.length, streams.length) - 1];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
    });
  });
  return asked;
}

const dayList = (page: Page, day: number) => page.getByTestId(`day-drop-list-${day}`);
// The toast's: the page's own Undo, for its edits, stays disabled here.
const undoButton = (page: Page) => page.getByRole("button", { name: "Undo", exact: true, disabled: false });

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
  await expect(dayList(page, 1)).toContainText(CATHEDRAL, { timeout: 60_000 });
}

test.describe("asking the AI on the trip page", () => {
  test.skip(
    !SUPA_URL || !SERVICE_KEY || !FIXTURE_TRIP_ID || !AUTH_STATE,
    "set SUPABASE_SERVICE_ROLE_KEY, KEY_FLOWS_TRIP_ID and KEY_FLOWS_AUTH_STATE",
  );
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 150_000 });

  let admin: SupabaseClient;
  let ownerId: string;
  let tripId: string;

  const storedRow = async () => {
    const { data, error } = await admin.from("trips").select("itinerary, end_date").eq("id", tripId).single();
    if (error) throw error;
    return data as { itinerary: ItineraryDay[]; end_date: string };
  };
  const storedNames = async () => (await storedRow()).itinerary.flatMap((d) => d.activities.map((a) => a.name));

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
      title: "E2E trip assistant (safe to delete)",
      description: "Automated E2E fixture. Safe to delete.",
      start_date: iso(40),
      end_date: iso(41),
      status: "planning",
      visibility: "private",
      itinerary: storedDays(),
      trip_meta: { destination: "Porto", e2e_fixture: true },
    });
    if (error) throw error;
  });

  test.afterEach(async () => {
    if (tripId) await admin.from("trips").delete().eq("id", tripId);
  });

  test.describe("the assistant", () => {
    async function openAssistant(page: Page): Promise<Locator> {
      await openTrip(page, tripId);
      await page.getByRole("button", { name: "Edit with AI" }).click({ timeout: 60_000 });
      const input = page.getByPlaceholder(/Replace the Colosseum/);
      await expect(input).toBeVisible();
      return input;
    }

    async function send(input: Locator, text: string) {
      await expect(input).toBeEnabled({ timeout: 30_000 });
      await input.fill(text);
      await input.press("Enter");
    }

    test("answers a question from the trip, and leaves it alone", async ({ page }) => {
      const asked = await answerTurns(page, { body: answered("The tram is the easy way up.") });
      await send(await openAssistant(page), "How do I get to the cathedral?");

      await expect(page.getByText("The tram is the easy way up.")).toBeVisible();
      await expect(page.getByText("No changes made to your itinerary")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save to my trip" })).toHaveCount(0);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ tripId, message: "How do I get to the cathedral?" });
      expect(asked[0].itinerary?.[0].activities[0].name).toBe(CATHEDRAL);
      expect(await storedNames()).toEqual(AS_STORED);
    });

    test("a prepared change waits for the button, lands on the page, and undoes", async ({ page }) => {
      await answerTurns(page, { body: prepared(calmerDayOne()) });
      await send(await openAssistant(page), "Make the first morning calmer");

      await expect(page.getByText("Not in your trip yet")).toBeVisible();
      await expect(page.getByText("Not saved yet: tap Save to my trip.")).toBeVisible();
      await expect(page.getByText("A calmer morning")).toBeVisible();
      expect(await storedNames()).toEqual(AS_STORED);
      await expect(dayList(page, 1)).toContainText(CATHEDRAL);

      await page.getByRole("button", { name: "Save to my trip" }).click();
      await expect.poll(storedNames, { timeout: 30_000 }).toEqual([GARDEN, LUNCH, BRIDGE]);
      await expect(dayList(page, 1)).toContainText(GARDEN);
      await expect(dayList(page, 1)).not.toContainText(CATHEDRAL);
      await expect(page.getByText(/days? updated/)).toBeVisible();
      await expect(page.getByText("Not in your trip yet")).toHaveCount(0);
      await expect(page.getByText("Not saved yet: tap Save to my trip.")).toHaveCount(0);

      await undoButton(page).click();
      await expect.poll(storedNames, { timeout: 30_000 }).toEqual(AS_STORED);
      await expect(dayList(page, 1)).toContainText(CATHEDRAL);
      await expect(page.getByText("Change undone successfully!")).toBeVisible();
    });

    test("a new day moves the trip's end date, and undo moves it back", async ({ page }) => {
      await answerTurns(page, { body: prepared(aThirdDay()) });
      await send(await openAssistant(page), "Add a day on the Douro");

      await expect(page.getByText(/Trip extended/)).toBeVisible();
      expect((await storedRow()).end_date).toBe(iso(41));

      await page.getByRole("button", { name: "Save to my trip" }).click();
      await expect.poll(async () => (await storedRow()).end_date, { timeout: 30_000 }).toBe(iso(42));
      expect((await storedRow()).itinerary.map((d) => d.day_number)).toEqual([1, 2, 3]);
      await expect(dayList(page, 3)).toContainText(GARDEN);

      await undoButton(page).click();
      await expect.poll(async () => (await storedRow()).end_date, { timeout: 30_000 }).toBe(iso(41));
      expect(await storedNames()).toEqual(AS_STORED);
      await expect(dayList(page, 3)).toHaveCount(0);
    });

    test("replying other than yes drops the change and says so; yes saves it", async ({ page }) => {
      const asked = await answerTurns(
        page,
        { body: prepared(calmerDayOne()) },
        { body: answered("Sure, what would you like instead?") },
        { body: prepared(calmerDayOne()) },
      );
      const input = await openAssistant(page);
      await send(input, "Make the first morning calmer");
      await expect(page.getByText("Not in your trip yet")).toBeVisible();

      await send(input, "Not that, something else");
      await expect(page.getByText("No problem! Let me know if you'd like to try something else.")).toBeVisible();
      await expect(page.getByText("Sure, what would you like instead?")).toBeVisible();
      await expect(page.getByText("Not in your trip yet")).toHaveCount(0);
      expect(await storedNames()).toEqual(AS_STORED);

      await send(input, "Then make the first morning calmer after all");
      await expect(page.getByText("Not in your trip yet")).toBeVisible();
      await send(input, "yes");
      await expect.poll(storedNames, { timeout: 30_000 }).toEqual([GARDEN, LUNCH, BRIDGE]);
      await expect(dayList(page, 1)).toContainText(GARDEN);
      // The yes was the tap they meant: it never reached the model.
      expect(asked).toHaveLength(3);
    });

    // Five restaurants waited on a card while the traveller asked for "the others
    // too", and the next card held only the others: the five were never saved.
    test("a request that builds on a waiting change keeps both, in one save", async ({ page }) => {
      const [dayOne] = (calmerDayOne() as Extract<PendingChange, { type: "apply_draft" }>).days;
      const dayTwo = storedDays()[1];
      const both: PendingChange = {
        type: "apply_draft",
        days: [dayOne, { ...dayTwo, activities: [...dayTwo.activities, activity("t-d2a2", CELLAR, "16:00")] }],
        changedDayNumbers: [1, 2],
      };
      const asked = await answerTurns(page, { body: prepared(calmerDayOne()) }, { body: { ...prepared(both), waitingKept: true } });
      const input = await openAssistant(page);
      await send(input, "Make the first morning calmer");
      await expect(page.getByText("Not in your trip yet")).toBeVisible();

      await send(input, "And a wine cellar on day 2 as well");
      await expect.poll(() => asked.length).toBe(2);
      await expect(page.getByText("Not in your trip yet")).toBeVisible();
      await expect(page.getByText("No problem! Let me know if you'd like to try something else.")).toHaveCount(0);
      expect(asked[1].waiting?.days?.map((d) => d.day_number)).toEqual([1]);
      expect(await storedNames()).toEqual(AS_STORED);

      await page.getByRole("button", { name: "Save to my trip" }).click();
      await expect.poll(storedNames, { timeout: 30_000 }).toEqual([GARDEN, LUNCH, BRIDGE, CELLAR]);
      await expect(dayList(page, 2)).toContainText(CELLAR);
    });

    test("a day with a fixed plan is refused by name, and stays", async ({ page }) => {
      const days = storedDays();
      days[0].activities[0] = { ...days[0].activities[0], locked: true };
      const { error } = await admin.from("trips").update({ itinerary: days }).eq("id", tripId);
      if (error) throw error;

      await answerTurns(page, { body: prepared(calmerDayOne()) });
      await send(await openAssistant(page), "Make the first morning calmer");
      await page.getByRole("button", { name: "Save to my trip" }).click();

      await expect(page.getByText(`This would change a fixed plan (${CATHEDRAL}), so it can't be done here.`)).toBeVisible();
      await expect(page.getByRole("button", { name: "Save to my trip" })).toBeVisible();
      expect(await storedNames()).toEqual(AS_STORED);
    });

    // The rest of a day with a fixed plan is the assistant's to change: the plan comes back as it was.
    test("a change beside a fixed plan is saved, and the fixed plan stays as it was", async ({ page }) => {
      const days = storedDays();
      days[0].activities[0] = { ...days[0].activities[0], locked: true };
      const { error } = await admin.from("trips").update({ itinerary: days }).eq("id", tripId);
      if (error) throw error;
      const [dayOne] = days;
      const beside: PendingChange = {
        type: "apply_draft",
        days: [{ ...dayOne, activities: [...dayOne.activities, activity("t-d1a3", CELLAR, "16:00")] }],
        changedDayNumbers: [1],
      };

      await answerTurns(page, { body: prepared(beside) });
      await send(await openAssistant(page), "Add a wine cellar on day 1");
      await page.getByRole("button", { name: "Save to my trip" }).click();

      await expect.poll(storedNames, { timeout: 30_000 }).toEqual([CATHEDRAL, LUNCH, CELLAR, BRIDGE]);
      expect((await storedRow()).itinerary[0].activities[0]).toMatchObject({ id: "t-d1a1", name: CATHEDRAL, start_time: "10:00", locked: true });
      await expect(dayList(page, 1)).toContainText(CELLAR);
    });

    test("undo refuses once the trip has moved on, and keeps the later change", async ({ page }) => {
      await answerTurns(page, { body: prepared(calmerDayOne()) });
      await send(await openAssistant(page), "Make the first morning calmer");
      await page.getByRole("button", { name: "Save to my trip" }).click();
      await expect.poll(storedNames, { timeout: 30_000 }).toEqual([GARDEN, LUNCH, BRIDGE]);
      await expect(dayList(page, 1)).toContainText(GARDEN);

      // A trip mate's save, or another tab's.
      const moved = (await storedRow()).itinerary;
      moved[1].activities[0].name = "Bridge walk at dusk";
      const { error } = await admin.from("trips").update({ itinerary: moved }).eq("id", tripId);
      if (error) throw error;

      await undoButton(page).click();
      await expect(page.getByText("Your trip has changed since then, so this can't be undone here.")).toBeVisible();
      expect(await storedNames()).toEqual([GARDEN, LUNCH, "Bridge walk at dusk"]);
    });

    test("a refused turn says why, and the panel can be asked again", async ({ page }) => {
      await answerTurns(
        page,
        { status: 429, body: { error: "Daily AI assistant message limit reached.", usage: { periodType: "daily" } } },
        { status: 500, body: { error: "Failed to process your request" } },
        { body: answered("The tram is the easy way up.") },
      );
      const input = await openAssistant(page);

      await send(input, "How do I get to the cathedral?");
      await expect(page.getByText("You've reached today's assistant limit. Try again tomorrow.")).toBeVisible();

      await send(input, "How do I get to the cathedral?");
      await expect(page.getByText("Something went wrong. Please try again.")).toBeVisible();

      await send(input, "How do I get to the cathedral?");
      await expect(page.getByText("The tram is the easy way up.")).toBeVisible();
      expect(await storedNames()).toEqual(AS_STORED);
    });
  });

  test.describe("the concierge", () => {
    const FIELD = "Ask the concierge";
    const done = { type: "done", isLiveTrip: false, dayNumber: null };

    const replaceTheCathedral = (oldActivity: Activity): PendingChange => ({
      type: "replace",
      oldActivity,
      newActivity: activity("t-d1a1-new", GARDEN, "10:00"),
      dayNumber: 1,
      reason: "Quieter in the morning.",
    });

    async function openConcierge(page: Page): Promise<Locator> {
      await openTrip(page, tripId);
      await page.getByRole("button", { name: "Ask concierge" }).click({ timeout: 60_000 });
      const dialog = page.getByRole("dialog", { name: "Trip concierge" });
      await expect(dialog).toBeVisible();
      return dialog;
    }

    async function askIn(dialog: Locator, question: string) {
      await expect(dialog.getByLabel(FIELD)).toBeEnabled({ timeout: 30_000 });
      await dialog.getByLabel(FIELD).fill(question);
      await dialog.getByRole("button", { name: "Ask", exact: true }).click();
    }

    test("streams an answer in, and asks with the local date", async ({ page }) => {
      const asked = await answerConcierge(page, [
        { type: "chunk", text: "Take the tram " },
        { type: "chunk", text: "up the hill." },
        { type: "done", isLiveTrip: true, dayNumber: 1 },
      ]);
      const dialog = await openConcierge(page);
      await askIn(dialog, "How do I get to the cathedral?");

      await expect(dialog.getByText("Take the tram up the hill.")).toBeVisible();
      await expect(dialog.getByText("How do I get to the cathedral?")).toBeVisible();
      await expect(dialog.getByText(/Today is in your trip window/)).toBeVisible();
      await expect(dialog.getByLabel(FIELD)).toHaveValue("");
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ tripId, question: "How do I get to the cathedral?", itineraryVersion: 0 });
      expect(asked[0].clientToday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(await storedNames()).toEqual(AS_STORED);
    });

    test("a proposed change waits for the button, lands on the page, and the next ask knows", async ({ page }) => {
      const asked = await answerConcierge(
        page,
        [{ type: "chunk", text: "The gardens are quieter." }, { type: "proposal", proposal: replaceTheCathedral(storedDays()[0].activities[0]) }, done],
        [{ type: "chunk", text: "It opens at nine." }, done],
      );
      const dialog = await openConcierge(page);
      await askIn(dialog, "Swap the cathedral for something quieter");

      await expect(dialog.getByText("Not in your trip yet")).toBeVisible();
      expect(await storedNames()).toEqual(AS_STORED);

      await dialog.getByRole("button", { name: "Save to my trip" }).click();
      await expect.poll(storedNames, { timeout: 30_000 }).toEqual([GARDEN, LUNCH, BRIDGE]);
      await expect(page.getByText("Change applied to your trip.")).toBeVisible();
      await expect(dialog.getByText("Not in your trip yet")).toHaveCount(0);
      await expect(dayList(page, 1)).toContainText(GARDEN);
      await expect(dayList(page, 1)).not.toContainText(CATHEDRAL);

      await askIn(dialog, "When does it open?");
      await expect(dialog.getByText("It opens at nine.")).toBeVisible();
      expect(asked.map((a) => a.itineraryVersion)).toEqual([0, 1]);
    });

    test("a proposal can be dismissed or tried again, and neither writes", async ({ page }) => {
      await answerConcierge(page, [
        { type: "chunk", text: "The gardens are quieter." },
        { type: "proposal", proposal: replaceTheCathedral(storedDays()[0].activities[0]) },
        done,
      ]);
      let applies = 0;
      await page.route("**/api/ai/assistant/apply", (route) => {
        applies += 1;
        return route.fallback();
      });
      const dialog = await openConcierge(page);

      await askIn(dialog, "Swap the cathedral for something quieter");
      await dialog.getByRole("button", { name: "Dismiss this change" }).click();
      await expect(dialog.getByText("Not in your trip yet")).toHaveCount(0);
      await expect(dialog.getByText("The gardens are quieter.")).toBeVisible();

      await askIn(dialog, "Swap the cathedral for something quieter");
      await dialog.getByRole("button", { name: "Try something different" }).click();
      await expect(dialog.getByText("Not in your trip yet")).toHaveCount(0);
      await expect(dialog.getByLabel(FIELD)).toHaveValue("Propose a different option for that.");

      expect(applies).toBe(0);
      expect(await storedNames()).toEqual(AS_STORED);
    });

    test("the daily limit and a failed answer each say so, and keep the question", async ({ page }) => {
      let asks = 0;
      await page.route("**/api/ai/concierge", (route) => {
        asks += 1;
        if (asks === 1) {
          return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "USAGE_LIMIT_REACHED" }) });
        }
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ type: "chunk", text: "Half an ans" })}\n\ndata: ${JSON.stringify({ type: "error" })}\n\n`,
        });
      });
      const dialog = await openConcierge(page);

      await askIn(dialog, "How do I get to the cathedral?");
      await expect(dialog.getByText("Daily AI limit reached. Try again tomorrow.")).toBeVisible();

      await askIn(dialog, "How do I get to the cathedral?");
      await expect(dialog.getByText("Couldn't answer right now. Try again in a moment.")).toBeVisible();
      await expect(dialog.getByText("Half an ans")).toHaveCount(0);
      await expect(dialog.getByLabel(FIELD)).toHaveValue("How do I get to the cathedral?");
    });

    test("a proposal for an activity no longer in the trip is refused, and the trip stays", async ({ page }) => {
      await answerConcierge(page, [
        { type: "chunk", text: "The gardens are quieter." },
        { type: "proposal", proposal: replaceTheCathedral(activity("t-gone", "A visit no longer planned", "10:00")) },
        done,
      ]);
      const dialog = await openConcierge(page);
      await askIn(dialog, "Swap that for something quieter");
      await dialog.getByRole("button", { name: "Save to my trip" }).click();

      await expect(page.getByText("Your trip has changed since this suggestion. Ask again for a fresh one.")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Save to my trip" })).toBeVisible();
      expect(await storedNames()).toEqual(AS_STORED);
    });
  });
});
