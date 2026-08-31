import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

/**
 * The AI assistant must never say it changed the trip unless it did.
 *
 * WHAT THIS REPRODUCES
 * --------------------
 * The assistant is confirm-first: for most actions the server PREPARES a
 * change, writes nothing, and shows a card with a button. But the text fed to
 * the model said, unconditionally:
 *
 *   "I have already replaced X with Y ... The change has been saved to the
 *    database and will appear in the itinerary."
 *
 * So it told people the work was done. Real transcripts, from the production
 * ai_conversations table:
 *
 *   "Why do I not see the requested change reflected in my trip planning"
 *   "It is still showing as southern steak and oyster"
 *   "i really can't see any changes"          <- 14 turns
 *   "I cant see them"                         <- 21 turns
 *
 * 158 of 161 recorded actions claimed `applied: true`. The flag was a literal
 * written at construction time, before any write was attempted, so it was a
 * constant rather than a fact.
 *
 * Four independent causes, all covered below:
 *   1. the model was told the change was saved even in preview mode
 *   2. `applied` was hardcoded true
 *   3. a fabricated action from the model survived when the server did nothing
 *   4. the prompt template handed the model `"applied": true` to copy
 *
 * Plus two the words alone would not have fixed:
 *   5. a past-tense "Activity Replaced" card, with a strike-through animation,
 *      rendered ABOVE the confirmation card
 *   6. typing a reply — including "yes" — silently destroyed the proposal
 *
 * WHY IT ASSERTS ON THE DATABASE
 * ------------------------------
 * Every one of these bugs is invisible in the UI transcript, which is exactly
 * how they survived. The only question that matters is whether trips.itinerary
 * changed, so that is what gets checked.
 *
 * REQUIRES
 *   npx tsx scripts/e2e-fixtures.mts --seed
 *   BASE_URL=http://localhost:3001 npx tsx scripts/e2e-login.mts
 *   BASE_URL=http://localhost:3001 npx playwright test assistant-honesty
 *
 * It mutates the fixture trip only, and restores it after each test.
 */

const AUTH_STATE = process.env.ASSISTANT_AUTH_STATE ?? ".auth/owner.json";
const MANIFEST = ".auth/e2e-fixtures.json";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL") url ||= v;
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY") key ||= v;
    }
  }
  return { url, key };
}

async function db() {
  const { createClient } = await import("@supabase/supabase-js");
  const { url, key } = creds();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ownerId: string | undefined = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8")).users?.owner?.id
  : undefined;

/**
 * This spec's own trip, created in beforeAll and destroyed in afterAll.
 *
 * NOT the shared fixture trip: that one carries three collaborators, which
 * flips TripDetailClient into the voting experience (votingEnabled =
 * isCollaborativeTrip && collaboratorCount > 1) and hides the ordinary edit
 * affordances, and its dates are in the past. A solo trip with future dates is
 * the plain owner case the assistant is built for.
 */
let tripId = "";

const DAY_ONE = [
  { id: "act_honesty_1", name: "Harbour Museum Tour", type: "attraction", time_slot: "morning",
    start_time: "10:00", duration_minutes: 90, description: "Fixture activity.",
    location: "Old Town", coordinates: { lat: 41.3874, lng: 2.1686 }, tips: [], booking_required: false },
  { id: "act_honesty_2", name: "Riverside Lunch Spot", type: "restaurant", time_slot: "afternoon",
    start_time: "13:00", duration_minutes: 60, description: "Fixture activity.",
    location: "Riverside", coordinates: { lat: 41.3809, lng: 2.1729 }, tips: [], booking_required: false },
];

/** Every activity name in the trip, straight from the row. */
async function activityNames(id: string): Promise<string[]> {
  const sb = await db();
  const { data } = await sb.from("trips").select("itinerary").eq("id", id).maybeSingle();
  const days = Array.isArray((data as { itinerary?: unknown })?.itinerary)
    ? ((data as { itinerary: unknown[] }).itinerary as Array<{ activities?: Array<{ name?: string }> }>)
    : [];
  return days.flatMap((d) => (d.activities ?? []).map((a) => a.name ?? ""));
}

/** The persisted transcript for this trip, newest conversation first. */
async function lastActions(id: string) {
  const sb = await db();
  const { data } = await sb
    .from("ai_conversations")
    .select("messages, updated_at")
    .eq("trip_id", id)
    .order("updated_at", { ascending: false })
    .limit(1);
  const msgs = Array.isArray((data?.[0] as { messages?: unknown })?.messages)
    ? ((data![0] as { messages: unknown[] }).messages as Array<{
        role?: string;
        content?: string;
        action?: { type?: string; applied?: boolean; pending?: boolean };
      }>)
    : [];
  return msgs.filter((m) => m.role === "assistant" && m.action).map((m) => m.action!);
}

/** Dismiss the consent banner, which overlays and blocks the whole UI. */
async function acceptEssential(page: Page) {
  const btn = page.getByRole("button", { name: /essential only|only essential/i });
  if (await btn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await btn.click();
    await btn.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

/** Open the assistant and return its message input. */
async function openAssistant(page: Page) {
  await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded" });
  await acceptEssential(page);
  const input = page.getByPlaceholder(/Replace the Colosseum/i);
  if (!(await input.isVisible({ timeout: 3000 }).catch(() => false))) {
    // Two entry points render depending on viewport; either opens the panel.
    const trigger = page
      .getByRole("button", { name: /trip assistant|ask ai|assistant/i })
      .first();
    if (await trigger.isVisible({ timeout: 8000 }).catch(() => false)) await trigger.click();
  }
  await input.waitFor({ state: "visible", timeout: 20_000 });
  return input;
}

/** Send a message and wait for the assistant to finish answering. */
async function ask(page: Page, text: string) {
  const input = page.getByPlaceholder(/Replace the Colosseum/i);
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await input.fill(text);
  await input.press("Enter");
  // The composer is disabled for the whole request, so its re-enabling is the
  // signal that generation finished. Waiting on the word "Thinking..." does
  // NOT work: the staged indicator says "Updating your trip", so that wait
  // passed instantly and every assertion then ran mid-generation.
  await expect(input).toBeDisabled({ timeout: 15_000 }).catch(() => {});
  await expect(input).toBeEnabled({ timeout: 120_000 });
}

/** The assistant's most recent reply text. */
async function lastReply(page: Page): Promise<string> {
  const bubbles = page.locator('[data-testid="assistant-message"], .prose, p');
  const n = await bubbles.count();
  const tail: string[] = [];
  for (let i = Math.max(0, n - 12); i < n; i++) {
    tail.push((await bubbles.nth(i).innerText().catch(() => "")) || "");
  }
  return tail.join("\n");
}

test.describe("assistant honesty", () => {
  test.use({ storageState: AUTH_STATE });
  test.skip(!ownerId, "no fixture owner — run scripts/e2e-fixtures.mts --seed");
  test.skip(!creds().url || !creds().key, "no service credentials to assert on the database");

  let before: string[] = [];
  let snapshot: unknown = null;

  test.beforeAll(async () => {
    if (!ownerId || !creds().url || !creds().key) return;
    const sb = await db();
    const start = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 23 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await sb
      .from("trips")
      .insert({
        user_id: ownerId,
        title: "E2E Assistant Honesty (safe to delete)",
        description: "Automated E2E fixture for the assistant honesty spec.",
        start_date: start,
        end_date: end,
        status: "planning",
        visibility: "private",
        itinerary: [{ day_number: 1, date: start, activities: DAY_ONE }],
        trip_meta: { destination: "Barcelona", e2e_fixture: true },
      })
      .select("id")
      .single();
    if (error) throw new Error(`could not create spec trip: ${error.message}`);
    tripId = (data as { id: string }).id;
  });

  test.afterAll(async () => {
    if (!tripId) return;
    const sb = await db();
    await sb.from("ai_conversations").delete().eq("trip_id", tripId);
    await sb.from("trips").delete().eq("id", tripId);
  });

  test.beforeEach(async () => {
    const sb = await db();
    const { data } = await sb.from("trips").select("itinerary").eq("id", tripId).maybeSingle();
    snapshot = (data as { itinerary?: unknown } | null)?.itinerary ?? null;
    // Start every test from an empty transcript. Otherwise assertions about
    // "was anything recorded as applied" see actions left by the previous
    // test — one of which applies a change legitimately.
    await sb.from("ai_conversations").delete().eq("trip_id", tripId);
    before = await activityNames(tripId);
    expect(before.length, "fixture trip has no activities to act on").toBeGreaterThan(0);
  });

  test.afterEach(async () => {
    // Restore the exact itinerary, so each test starts from the same trip and
    // a failure part-way through cannot poison the next one. These tests write
    // to a real row — the fixture trip — by design; there is no second
    // database, which is why the restore is not optional.
    if (snapshot === null) return;
    const sb = await db();
    await sb.from("trips").update({ itinerary: snapshot }).eq("id", tripId);
  });

  test("a proposed change does not claim to be done, and does not touch the trip", async ({ page }) => {
    await openAssistant(page);
    await ask(page, `Replace ${before[0]} with a quiet neighbourhood cafe`);

    const reply = await lastReply(page);

    // CAUSE 1 — the sentence itself. These are the exact shapes users saw.
    expect(reply, "assistant claimed a change it had not made").not.toMatch(
      /\b(has been|have been|i(?:'ve| have))\s+(replaced|added|removed|updated|saved|changed)\b/i
    );
    expect(reply, "assistant said the change was saved").not.toMatch(
      /saved to (the )?(database|your trip's? database)/i
    );

    // The reply is read by a person on a phone. A guideline telling the model
    // to "ALWAYS include the full new activity object" made it paste the raw
    // activity JSON into the chat once the action object left the schema.
    expect(reply, "raw JSON leaked into the chat reply").not.toMatch(/```|"duration_minutes"|"time_slot"|"booking_required"/);

    // CAUSE 5 — the visual. A card headed "Activity Replaced", past tense,
    // used to render ABOVE the confirmation card and animate a red
    // strike-through. It is the strongest thing on screen and no wording fix
    // reaches it.
    await expect(
      page.getByText(/Activity Replaced/i),
      "past-tense completion card rendered while the change was only proposed"
    ).toHaveCount(0);

    // The honest UI: the card names its own state and the button says what
    // tapping it does.
    await expect(page.getByText(/Not in your trip yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Save to my trip/i })).toBeVisible();

    // CAUSE 2 — the trip itself must be untouched.
    expect(await activityNames(tripId), "a preview wrote to the itinerary").toEqual(before);

    // ...and the transcript must say so rather than claiming success.
    const actions = await lastActions(tripId);
    const latest = actions[actions.length - 1];
    if (latest) {
      expect(latest.applied, "recorded applied:true for a change that was only proposed").toBe(false);
      expect(latest.pending).toBe(true);
    }
  });

  test("tapping Save to my trip actually writes it", async ({ page }) => {
    await openAssistant(page);
    await ask(page, `Replace ${before[0]} with a quiet neighbourhood cafe`);

    await page.getByRole("button", { name: /Save to my trip/i }).click();

    await expect
      .poll(async () => (await activityNames(tripId)).join("|"), { timeout: 60_000 })
      .not.toBe(before.join("|"));

    // And the transcript now records it, so a reload cannot report the change
    // as never having happened — which is what sent users back to ask twice
    // and produced duplicates.
    await expect
      .poll(async () => (await lastActions(tripId)).some((a) => a.applied === true), {
        timeout: 30_000,
      })
      .toBe(true);
  });

  test('replying "yes" applies the change instead of destroying it', async ({ page }) => {
    await openAssistant(page);
    await ask(page, `Replace ${before[0]} with a quiet neighbourhood cafe`);
    await expect(page.getByRole("button", { name: /Save to my trip/i })).toBeVisible();

    // Replying is the single most likely thing a person does when an
    // assistant offers them something. It used to silently discard the
    // proposal: sendMessage opened with setPendingChange(null).
    const input = page.getByPlaceholder(/Replace the Colosseum/i);
    await input.fill("yes");
    await input.press("Enter");

    await expect
      .poll(async () => (await activityNames(tripId)).join("|"), { timeout: 60_000 })
      .not.toBe(before.join("|"));
  });

  test("a removal is proposed, never silently claimed", async ({ page }) => {
    await openAssistant(page);
    // "remove" was detected as an intent and offered in the prompt's action
    // list, but NO handler existed for it in the route. The model filled the
    // gap from the template's own example: 12 "remove_activity ... applied:
    // true" records exist in production for removals that never happened, and
    // a live run produced "The Harbour Museum Tour has been removed from your
    // Day 1 plans" for an activity still sitting in the trip.
    //
    // Removal is now implemented, so this asserts the honest path: it is
    // PREPARED, the itinerary is untouched until confirmed, and nothing is
    // recorded as done.
    await ask(page, `Remove ${before[0]} from my trip entirely`);

    expect(await activityNames(tripId), "an unimplemented action mutated the trip").toEqual(before);

    const actions = await lastActions(tripId);
    expect(
      actions.filter((a) => a.applied === true).length,
      "recorded a completed action for something the server never did"
    ).toBe(0);

    const reply = await lastReply(page);
    expect(reply, "assistant claimed a removal that never happened").not.toMatch(
      /\b(has been|have been|i(?:'ve| have))\s+removed\b/i
    );
  });
});
