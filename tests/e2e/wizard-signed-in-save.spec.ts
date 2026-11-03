import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import draft from "./fixtures/wizard-draft-paris.json";
import { stubGeneration, stubPlan } from "./generation-stub";

/**
 * A signed-in planner who comes back to the wizard with an unsaved plan gets it
 * back without being asked, and auto-save keeps it as one of their trips: the
 * row holds every day and activity, and the trip page shows them. When they
 * already saved a trip to the same place on the same dates, the wizard asks
 * first: update that trip, or save this one as a separate trip. A trip they
 * generate is saved the same way, and a plan they shared while signed out
 * becomes their trip when they sign in, without a second save.
 *
 * The plans are the restored-draft fixture, and a generation is answered by
 * the test (generation-stub.ts), so no model is called. Analytics, photos and
 * maps are blocked; the saves are real, and the trips are removed afterwards.
 *
 * Needs the fixture accounts (scripts/e2e-fixtures.mts --seed, then
 * scripts/e2e-login.mts) and service credentials:
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json npx playwright test tests/e2e/wizard-signed-in-save.spec.ts
 */

type Draft = typeof draft;
type Day = { activities: { id?: string; name: string }[] };

const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;
const MANIFEST = ".auth/e2e-fixtures.json";
const DRAFT_KEY = "monkeytravel-itinerary-draft";

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

function ownerId(): string | null {
  if (!existsSync(MANIFEST)) return null;
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { users?: { owner?: { id?: string } } };
  return manifest.users?.owner?.id ?? null;
}

/**
 * The same trip planned again: new activity ids, as a new generation mints,
 * and a first activity of its own so the saved copy can be told apart.
 */
function planAgain(): Draft {
  const again = structuredClone(draft);
  for (const day of again.generatedItinerary.days) {
    for (const activity of day.activities) activity.id = `${activity.id}-again`;
  }
  again.generatedItinerary.days[0].activities[0].name = "Breakfast at Du Pain et des Idées";
  return again;
}

const activityNames = (days: Day[]) => days.map((d) => d.activities.map((a) => a.name));

async function isolate(page: Page) {
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (/(googletagmanager|google-analytics|posthog|buildhop)\.|^maps\.googleapis\.com$/.test(url.host)) {
      return route.abort();
    }
    if (/^\/api\/(wizard-event|consent-event|page-engaged|page-view|session)/.test(url.pathname)) {
      return route.fulfill({ status: 204, body: "" });
    }
    if (/^\/api\/(places|images|img)(\/|$)/.test(url.pathname) || req.resourceType() === "image") {
      return route.abort();
    }
    return route.continue();
  });
}

/** From step 1, plans the first popular pick with one vibe, and asks for it. */
async function planFirstPick(page: Page) {
  const pick = page.getByRole("group", { name: "Popular right now" }).getByRole("button").first();
  await pick.click({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.getByRole("heading", { name: "Set your travel style" }).waitFor();
  // The cards animate in, and a click landing mid-entrance is lost.
  const foodie = page.getByText("Foodie Journey", { exact: true }).filter({ visible: true }).first();
  const generate = page.getByRole("button", { name: "Generate Itinerary" });
  await expect(async () => {
    if (await generate.isDisabled()) await foodie.click();
    await expect(generate).toBeEnabled({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await generate.click();
}

/** Opens the wizard with `plan` waiting as the unsaved draft. */
async function openWithDraft(page: Page, plan: Draft) {
  // Once per tab: the wizard rewrites the draft as it restores it.
  await page.addInitScript(
    ({ draftKey, value }) => {
      if (sessionStorage.getItem("e2e-draft-seeded")) return;
      localStorage.setItem(draftKey, JSON.stringify({ ...value, savedAt: Date.now() }));
      sessionStorage.setItem("e2e-draft-seeded", "1");
    },
    { draftKey: DRAFT_KEY, value: plan }
  );
  await page.goto("/trips/new");
  await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Unsaved trip found")).toHaveCount(0);
}

test.describe("wizard: a signed-in planner's unsaved plan", () => {
  const { url, key } = creds();
  const owner = ownerId();
  test.skip(!AUTH_STATE || !owner || !url || !key, "run e2e-fixtures --seed and e2e-login, and set KEY_FLOWS_AUTH_STATE");
  test.use({ storageState: AUTH_STATE });

  let db: SupabaseClient;

  async function savedCopies() {
    const { data, error } = await db
      .from("trips")
      .select("id, title, visibility, itinerary")
      .eq("user_id", owner!)
      .eq("start_date", draft.startDate)
      .eq("end_date", draft.endDate)
      .order("created_at", { ascending: true });
    expect(error).toBeNull();
    return (data ?? []) as { id: string; title: string; visibility: string; itinerary: Day[] }[];
  }

  // Every copy a run saved, so a retry starts from none.
  async function removeSavedCopies() {
    const { error } = await db
      .from("trips")
      .delete()
      .eq("user_id", owner!)
      .eq("start_date", draft.startDate)
      .eq("end_date", draft.endDate);
    expect(error, "could not remove the saved trips").toBeNull();
  }

  /** A trip the owner saved earlier, for the same place and dates. */
  async function saveEarlierTrip() {
    const { data, error } = await db
      .from("trips")
      .insert({
        user_id: owner,
        title: "Paris",
        description: draft.generatedItinerary.destination.description,
        start_date: draft.startDate,
        end_date: draft.endDate,
        status: "planning",
        itinerary: draft.generatedItinerary.days,
        trip_meta: { destination: draft.destination },
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  }

  test.beforeEach(async ({ page }) => {
    db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await removeSavedCopies();
    await isolate(page);
  });

  test.afterEach(async () => {
    await removeSavedCopies();
  });

  test("comes back on its own and is saved with every day and activity", async ({ page }) => {
    await openWithDraft(page, draft);

    const viewTrip = page.getByRole("link", { name: /View trip/ }).first();
    await expect(viewTrip, "auto-save did not finish").toBeVisible({ timeout: 30_000 });

    const saved = await savedCopies();
    expect(saved, "the plan should be saved exactly once").toHaveLength(1);
    expect(saved[0].visibility).toBe("private");
    expect(activityNames(saved[0].itinerary)).toEqual(activityNames(draft.generatedItinerary.days));
    await expect(viewTrip).toHaveAttribute("href", new RegExp(`/trips/${saved[0].id}$`));

    await viewTrip.click();
    await page.waitForURL(new RegExp(`/trips/${saved[0].id}`), { timeout: 60_000 });
    for (const day of draft.generatedItinerary.days) {
      for (const activity of day.activities) {
        await expect(page.getByText(activity.name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      }
    }
  });

  test("asks before saving a second trip to the same place and dates, and keeps both", async ({ page }) => {
    const earlierId = await saveEarlierTrip();
    const again = planAgain();
    await openWithDraft(page, again);

    await expect(page.getByText(/You already have “Paris” for these dates/)).toBeVisible({ timeout: 30_000 });
    expect(await savedCopies(), "nothing is saved before the planner answers").toHaveLength(1);

    await page.getByRole("button", { name: "Save as a separate trip" }).click();
    await expect(page.getByRole("link", { name: /View trip/ }).first()).toBeVisible({ timeout: 30_000 });

    const saved = await savedCopies();
    expect(saved).toHaveLength(2);
    expect(saved[0].id).toBe(earlierId);
    expect(activityNames(saved[0].itinerary)).toEqual(activityNames(draft.generatedItinerary.days));
    expect(activityNames(saved[1].itinerary)).toEqual(activityNames(again.generatedItinerary.days));
  });

  test("updates the trip saved earlier when the planner chooses it", async ({ page }) => {
    const earlierId = await saveEarlierTrip();
    const again = planAgain();
    await openWithDraft(page, again);

    await page.getByRole("button", { name: "Update my saved trip" }).click({ timeout: 30_000 });
    const viewTrip = page.getByRole("link", { name: /View trip/ }).first();
    await expect(viewTrip).toBeVisible({ timeout: 30_000 });
    await expect(viewTrip).toHaveAttribute("href", new RegExp(`/trips/${earlierId}$`));

    await expect
      .poll(async () => (await savedCopies()).map((t) => [t.id, activityNames(t.itinerary)[0][0]]), { timeout: 30_000 })
      .toEqual([[earlierId, "Breakfast at Du Pain et des Idées"]]);
  });
});

test.describe("wizard: a trip a signed-in planner generates", () => {
  const { url, key } = creds();
  const owner = ownerId();
  test.skip(!AUTH_STATE || !owner || !url || !key, "run e2e-fixtures --seed and e2e-login, and set KEY_FLOWS_AUTH_STATE");
  test.use({ storageState: AUTH_STATE });

  let db: SupabaseClient;
  let dates: { start: string; end: string } | null = null;

  async function removeGenerated() {
    if (!dates) return;
    const { error } = await db
      .from("trips")
      .delete()
      .eq("user_id", owner!)
      .eq("start_date", dates.start)
      .eq("end_date", dates.end);
    expect(error, "could not remove the saved trip").toBeNull();
  }

  test.beforeEach(async ({ page }) => {
    db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await isolate(page);
  });

  test.afterEach(async () => {
    await removeGenerated();
  });

  test("is saved with every day it was given", async ({ page }) => {
    // After the catch-all: the last route registered is asked first.
    const generation = await stubGeneration(page);
    await page.goto("/trips/new");
    await planFirstPick(page);

    const viewTrip = page.getByRole("link", { name: /View trip/ }).first();
    await expect(viewTrip, "auto-save did not finish").toBeVisible({ timeout: 60_000 });
    expect(generation.streamed).toHaveLength(1);
    const request = generation.streamed[0];
    dates = { start: request.startDate, end: request.endDate };
    const plan = stubPlan(request);

    const { data, error } = await db
      .from("trips")
      .select("id, itinerary")
      .eq("user_id", owner!)
      .eq("start_date", dates.start)
      .eq("end_date", dates.end);
    expect(error).toBeNull();
    expect(data, "the plan should be saved exactly once").toHaveLength(1);
    expect(activityNames(data![0].itinerary as Day[])).toEqual(activityNames(plan.days));
    await expect(viewTrip).toHaveAttribute("href", new RegExp(`/trips/${data![0].id}$`));
  });
});

test.describe("wizard: a plan shared before signing in", () => {
  const { url, key } = creds();
  const owner = ownerId();
  test.skip(!AUTH_STATE || !owner || !url || !key, "run e2e-fixtures --seed and e2e-login, and set KEY_FLOWS_AUTH_STATE");
  // No storageState: the planner starts signed out and signs in halfway.

  let db: SupabaseClient;
  let sharedTripId: string | null = null;
  let dates: { start: string; end: string } | null = null;

  test.beforeEach(async ({ page }) => {
    db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await isolate(page);
  });

  test.afterEach(async () => {
    if (sharedTripId) await db.from("trips").delete().eq("id", sharedTripId);
    if (dates) await db.from("trips").delete().eq("user_id", owner!).eq("start_date", dates.start).eq("end_date", dates.end);
  });

  test("becomes the planner's trip when they sign in, and is not saved twice", async ({ page, context }) => {
    const generation = await stubGeneration(page);
    await page.goto("/trips/new");
    const essentialOnly = page.getByRole("button", { name: /essential only/i });
    await essentialOnly
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => essentialOnly.click())
      .catch(() => {});
    await planFirstPick(page);
    await expect(page.getByRole("button", { name: /Save Trip/ }).first()).toBeVisible({ timeout: 60_000 });
    const request = generation.streamed[0];
    dates = { start: request.startDate, end: request.endDate };

    // Shared while signed out: the server keeps an ownerless trip, and this
    // browser keeps the token that claims it.
    const shared = page.waitForResponse((r) => r.url().endsWith("/api/trips/anonymous") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Share this trip" }).first().click();
    const response = await shared;
    expect(response.ok(), "the share link was not created").toBe(true);
    sharedTripId = ((await response.json()) as { tripId: string }).tripId;

    // Signing in leaves the session in cookies; the wizard opens again with
    // the plan restored, claims the shared trip, and keeps it as the save.
    const signedIn = JSON.parse(readFileSync(AUTH_STATE!, "utf8")) as { cookies: Parameters<typeof context.addCookies>[0] };
    await context.addCookies(signedIn.cookies);
    await page.goto("/trips/new");
    await expect(page.getByRole("link", { name: /View trip/ }).first()).toHaveAttribute(
      "href",
      new RegExp(`/trips/${sharedTripId}$`),
      { timeout: 60_000 }
    );

    const { data, error } = await db
      .from("trips")
      .select("id, user_id")
      .eq("start_date", dates.start)
      .eq("end_date", dates.end)
      .or(`user_id.eq.${owner},id.eq.${sharedTripId}`);
    expect(error).toBeNull();
    expect(data, "one trip: the shared one, now the planner's").toEqual([{ id: sharedTripId, user_id: owner }]);
  });
});
