import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import draft from "./fixtures/wizard-draft-paris.json";
import { stubGeneration, stubPlan } from "./generation-stub";
import { serviceCreds, readManifest } from "./env";

/**
 * A signed-in planner who comes back to the wizard with an unsaved plan gets it
 * back without being asked, and auto-save keeps it as one of their trips: the
 * row holds every day and activity, and the trip page shows them. When they
 * already saved a trip to the same place on the same dates, the wizard asks
 * first: update that trip, or save this one as a separate trip. A trip they
 * generate is saved the same way, and a plan they shared while signed out
 * becomes their trip when they sign in, without a second save: Save waits
 * while the claim runs. A kept plan's link is saved the same way, once:
 * opened again, it leads to their trips. A planner who reaches the
 * free-generation cap signed out gets the trip generated and saved once they
 * sign in.
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
const DRAFT_KEY = "monkeytravel-itinerary-draft";

function ownerId(): string | null {
  return readManifest()?.users.owner.id ?? null;
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
    if (/(googletagmanager|google-analytics|posthog)\.|^maps\.googleapis\.com$/.test(url.host)) {
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

/**
 * From step 1, plans the first popular pick with one vibe, and asks for it.
 * `whosComing` is answered after the place, as most planners do.
 */
async function planFirstPick(page: Page, whosComing?: "Just me" | "With friends") {
  const pick = page.getByRole("group", { name: "Popular right now" }).getByRole("button").first();
  await pick.click({ timeout: 60_000 });
  if (whosComing) await page.getByRole("button", { name: whosComing, exact: true }).click();
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
  const { url, key } = serviceCreds();
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
    // The one in the plan: a stop that needs booking is also named in the
    // book-ahead list, which waits closed behind its chip.
    for (const day of draft.generatedItinerary.days) {
      for (const activity of day.activities) {
        await expect(page.getByText(activity.name, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
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

  test("a kept plan's link is saved once, and opened again leads to their trips", async ({ page }) => {
    const token = "S".repeat(22);
    const kept = {
      destination: draft.destination,
      startDate: draft.startDate,
      endDate: draft.endDate,
      itinerary: draft.generatedItinerary,
    };
    await page.route(`**/api/plans/${token}`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ plan: kept, expiresAt: "2099-01-01T00:00:00.000Z" }),
          })
        : route.fulfill({ status: 503, body: "" })
    );

    await page.goto(`/trips/new#plan=${token}`);
    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: /View trip/ }).first(), "auto-save did not finish").toBeVisible({
      timeout: 30_000,
    });
    const saved = await savedCopies();
    expect(saved, "the plan should be saved exactly once").toHaveLength(1);
    expect(activityNames(saved[0].itinerary)).toEqual(activityNames(draft.generatedItinerary.days));

    // A new load, not a same-page jump to the link.
    await page.goto("about:blank");
    await page.goto(`/trips/new#plan=${token}`);
    await page.waitForURL(/\/trips$/, { timeout: 60_000 });
    expect(await savedCopies(), "a plan already among their trips is not saved again").toHaveLength(1);
  });
});

test.describe("wizard: a trip a signed-in planner generates", () => {
  const { url, key } = serviceCreds();
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

  test("is counted in the funnel with the answers it was planned with", async ({ page }) => {
    const events: { step: string; group_size?: string }[] = [];
    await page.route("**/api/wizard-event", (route) => {
      events.push(route.request().postDataJSON());
      return route.fulfill({ status: 204, body: "" });
    });
    const generation = await stubGeneration(page);
    await page.goto("/trips/new");
    await planFirstPick(page, "With friends");

    await expect(page.getByRole("link", { name: /View trip/ }).first(), "auto-save did not finish").toBeVisible({
      timeout: 60_000,
    });
    dates = { start: generation.streamed[0].startDate, end: generation.streamed[0].endDate };
    const groupOf = (step: string) => events.find((e) => e.step === step)?.group_size;
    expect(groupOf("generating")).toBe("group");
    await expect.poll(() => groupOf("saved"), { message: "the saved trip's funnel row" }).toBe("group");
  });
});

test.describe("wizard: a plan shared before signing in", () => {
  const { url, key } = serviceCreds();
  const owner = ownerId();
  test.skip(!AUTH_STATE || !owner || !url || !key, "run e2e-fixtures --seed and e2e-login, and set KEY_FLOWS_AUTH_STATE");
  // No storageState: the planner starts signed out and signs in halfway.

  let db: SupabaseClient;
  let sharedTripId: string | null = null;
  let dates: { start: string; end: string } | null = null;

  test.beforeEach(async ({ page }) => {
    db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    sharedTripId = null;
    dates = null;
    await isolate(page);
  });

  test.afterEach(async () => {
    if (sharedTripId) await db.from("trips").delete().eq("id", sharedTripId);
    if (dates) await db.from("trips").delete().eq("user_id", owner!).eq("start_date", dates.start).eq("end_date", dates.end);
  });

  /**
   * Plans the first pick signed out and shares it: the server keeps an
   * ownerless trip, and this browser keeps the token that claims it.
   */
  async function shareSignedOut(page: Page) {
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

    const shared = page.waitForResponse((r) => r.url().endsWith("/api/trips/anonymous") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Share this trip" }).first().click();
    const response = await shared;
    expect(response.ok(), "the share link was not created").toBe(true);
    sharedTripId = ((await response.json()) as { tripId: string }).tripId;
  }

  /** Signs in: the session is left in cookies, as the sign-in page leaves it. */
  async function signIn(context: BrowserContext) {
    const signedIn = JSON.parse(readFileSync(AUTH_STATE!, "utf8")) as { cookies: Parameters<typeof context.addCookies>[0] };
    await context.addCookies(signedIn.cookies);
  }

  /** The planner's trips on the shared plan's dates, and the shared trip itself. */
  async function tripsOnTheseDates() {
    const { data, error } = await db
      .from("trips")
      .select("id, user_id")
      .eq("start_date", dates!.start)
      .eq("end_date", dates!.end)
      .or(`user_id.eq.${owner},id.eq.${sharedTripId}`);
    expect(error).toBeNull();
    return data;
  }

  test("becomes the planner's trip when they sign in, and is not saved twice", async ({ page, context }) => {
    await shareSignedOut(page);

    // The wizard opens again with the plan restored, claims the shared trip,
    // and keeps it as the save.
    await signIn(context);
    await page.goto("/trips/new");
    await expect(page.getByRole("link", { name: /View trip/ }).first()).toHaveAttribute(
      "href",
      new RegExp(`/trips/${sharedTripId}$`),
      { timeout: 60_000 }
    );

    expect(await tripsOnTheseDates(), "one trip: the shared one, now the planner's").toEqual([
      { id: sharedTripId, user_id: owner },
    ]);
  });

  test("comes back as the saved trip when the claim lands before the draft check", async ({ page, context }) => {
    await shareSignedOut(page);
    // The draft check asks whether the restored plan is already one of the
    // planner's trips. Answer it only once the claim has made the shared trip
    // theirs: the order in which the plan was dropped as "already saved".
    let claimLanded!: () => void;
    const landed = new Promise<void>((resolve) => (claimLanded = resolve));
    page.on("response", (response) => {
      if (response.url().endsWith("/api/trips/claim")) claimLanded();
    });
    await page.route(/\/rest\/v1\/trips\?.*itinerary=cs\./, async (route) => {
      await landed;
      await route.fallback();
    });

    await signIn(context);
    await page.goto("/trips/new");
    await expect(page.getByRole("link", { name: /View trip/ }).first()).toHaveAttribute(
      "href",
      new RegExp(`/trips/${sharedTripId}$`),
      { timeout: 60_000 }
    );
    expect(await tripsOnTheseDates(), "one trip: the shared one, now the planner's").toEqual([
      { id: sharedTripId, user_id: owner },
    ]);
  });

  test("Save waits while the claim runs, so it adds no second copy", async ({ page, context }) => {
    await shareSignedOut(page);
    // The claim is held until Save has been seen waiting (the last route registered is asked first).
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/trips/claim", async (route) => {
      await held;
      await route.fallback();
    });

    await signIn(context);
    await page.goto("/trips/new");
    const saving = page.getByRole("button", { name: "Saving..." }).first();
    await expect(saving).toBeVisible({ timeout: 60_000 });
    await expect(saving).toBeDisabled();
    await expect(page.getByRole("button", { name: /Save Trip/ })).toHaveCount(0);

    release();
    await expect(page.getByRole("link", { name: /View trip/ }).first()).toHaveAttribute(
      "href",
      new RegExp(`/trips/${sharedTripId}$`),
      { timeout: 60_000 }
    );
    expect(await tripsOnTheseDates(), "one trip: the shared one, now the planner's").toEqual([
      { id: sharedTripId, user_id: owner },
    ]);
  });
});

test.describe("wizard: the free-generation cap", () => {
  const { url, key } = serviceCreds();
  const owner = ownerId();
  test.skip(!AUTH_STATE || !owner || !url || !key, "run e2e-fixtures --seed and e2e-login, and set KEY_FLOWS_AUTH_STATE");
  // No storageState: the planner reaches the cap signed out.

  let db: SupabaseClient;
  let dates: { start: string; end: string } | null = null;

  test.beforeEach(async ({ page }) => {
    db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await isolate(page);
  });

  test.afterEach(async () => {
    if (dates) await db.from("trips").delete().eq("user_id", owner!).eq("start_date", dates.start).eq("end_date", dates.end);
  });

  test("asks for an account, and generates the trip once the planner signs in", async ({ page, context }) => {
    const generation = await stubGeneration(page);
    // Both generation endpoints refuse a signed-out planner at the cap, as the
    // server does; the stub answers again once they have signed in.
    let capped = true;
    const cap = { status: 429, contentType: "application/json", body: JSON.stringify({ error: "Free plans used", code: "RATE_LIMIT" }) };
    for (const endpoint of ["**/api/ai/generate/stream", "**/api/ai/generate"]) {
      await page.route(endpoint, (route) => (capped ? route.fulfill(cap) : route.fallback()));
    }

    await page.goto("/trips/new");
    const essentialOnly = page.getByRole("button", { name: /essential only/i });
    await essentialOnly
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => essentialOnly.click())
      .catch(() => {});
    await planFirstPick(page);
    const signIn = page.getByRole("button", { name: "Already have an account? Sign in" });
    await expect(signIn, "the cap asks for an account").toBeVisible({ timeout: 30_000 });
    expect(generation.streamed, "a capped generation is not answered").toHaveLength(0);

    // Choosing to sign in keeps the intent; signing in leaves the session in
    // cookies and brings the planner back to the wizard for that place.
    await signIn.click();
    await page.waitForURL(/\/auth\/login\?/);
    const back = new URL(page.url()).searchParams.get("redirect");
    expect(back, "the sign-in page knows the way back").toMatch(/^\/trips\/new\?destination=/);
    capped = false;
    const signedIn = JSON.parse(readFileSync(AUTH_STATE!, "utf8")) as { cookies: Parameters<typeof context.addCookies>[0] };
    await context.addCookies(signedIn.cookies);
    await page.goto(back!);

    const viewTrip = page.getByRole("link", { name: /View trip/ }).first();
    await expect(viewTrip, "the resumed generation was not saved").toBeVisible({ timeout: 60_000 });
    expect(generation.streamed).toHaveLength(1);
    const request = generation.streamed[0];
    dates = { start: request.startDate, end: request.endDate };
    const { data, error } = await db.from("trips").select("id").eq("user_id", owner!).eq("start_date", dates.start).eq("end_date", dates.end);
    expect(error).toBeNull();
    expect(data, "the resumed trip should be saved exactly once").toHaveLength(1);
    await expect(viewTrip).toHaveAttribute("href", new RegExp(`/trips/${data![0].id}$`));
  });
});
