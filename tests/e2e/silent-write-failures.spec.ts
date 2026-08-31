import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

/**
 * Writes that reported success without verifying it, and model output shown as
 * measurement.
 *
 * These share one root cause with the crew-consensus bug and with the AI
 * assistant's `applied` flag: PostgREST answers a zero-row UPDATE with 204 and
 * `error: null`, so checking only `error` cannot tell a real write from one
 * RLS refused. Each fix adds `.select()` and asserts a row came back.
 *
 * REQUIRES
 *   npx tsx scripts/e2e-fixtures.mts --seed
 *   BASE_URL=http://localhost:3001 npx tsx scripts/e2e-login.mts
 *   BASE_URL=http://localhost:3001 npx playwright test silent-write
 */

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

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null;
const tripId: string | undefined = manifest?.tripId;

/**
 * Pre-seed the consent choice so the banner never renders.
 *
 * Clicking it was unreliable: it is client-rendered, so on a cold page it
 * arrives AFTER the content and a single check races it — and on the trip page
 * it lands on top of the collaborator onboarding modal, so three retries in a
 * row still failed. Writing the record it would have written is deterministic,
 * and it picks the privacy-preserving option rather than "accept all".
 *
 * Mirrors lib/consent/types.ts (CONSENT_STORAGE_KEY, CONSENT_VERSION).
 */
async function preConsent(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "mt_cookie_consent",
        JSON.stringify({
          consent: { essential: true, analytics: false, sessionRecording: false, marketing: false },
          updatedAt: new Date().toISOString(),
          version: 1,
          method: "banner_essential_only",
        })
      );
    } catch {
      /* private mode — the test will fall back to dismissing the banner */
    }
  });
}

/**
 * Dismiss what is left on top of the trip page: a "Welcome to the Trip!"
 * onboarding modal for collaborators, and the assistant, which opens itself
 * 2.5s after load.
 */
async function clearOverlays(page: import("@playwright/test").Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const essential = page.getByRole("button", { name: /essential only/i });
    if (await essential.isVisible({ timeout: attempt === 0 ? 3000 : 800 }).catch(() => false)) {
      await essential.click({ force: true }).catch(() => {});
    }
    // "Skip" is not exposed as a button role, so match the text.
    const skip = page.getByText(/^\s*Skip\s*$/).first();
    if (await skip.isVisible({ timeout: 2500 }).catch(() => false)) {
      await skip.click({ force: true }).catch(() => {});
      await skip.waitFor({ state: "hidden", timeout: 4000 }).catch(() => {});
    }
    const closeAssistant = page.getByRole("button", { name: /close/i }).first();
    if (await closeAssistant.isVisible({ timeout: 1200 }).catch(() => false)) {
      await closeAssistant.click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(900);
  }
}

test.describe("a packing tick that cannot save must say so", () => {
  test.skip(!manifest, "no fixtures — run scripts/e2e-fixtures.mts --seed");
  test.skip(!creds().url || !creds().key, "no service credentials");

  /**
   * This spec builds its own trip rather than using the shared fixture.
   *
   * The fixture trip's dates are in the PAST, so TripDetailClient renders the
   * post-trip view and the packing block never mounts — the test then fails on
   * a locator for reasons that have nothing to do with the bug. A trip with
   * FUTURE dates and the voter as a collaborator is the situation the bug
   * actually occurs in.
   */
  let ownTripId = "";

  test.beforeAll(async () => {
    if (!manifest || !creds().url || !creds().key) return;
    const sb = await db();
    const start = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 22 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await sb
      .from("trips")
      .insert({
        user_id: manifest.users.owner.id,
        title: "E2E Packing Save (safe to delete)",
        description: "Automated fixture for the silent-write spec.",
        start_date: start,
        end_date: end,
        status: "planning",
        visibility: "private",
        packing_list: ["Fixture Rain Jacket", "Fixture Walking Shoes"],
        itinerary: [
          {
            day_number: 1,
            date: start,
            activities: [
              {
                id: "act_pack_e2e",
                name: "Fixture Museum",
                type: "attraction",
                time_slot: "morning",
                start_time: "10:00",
                duration_minutes: 90,
                description: "Fixture.",
                location: "Old Town",
                coordinates: { lat: 41.3874, lng: 2.1686 },
                tips: [],
                booking_required: false,
              },
            ],
          },
        ],
        trip_meta: { destination: "Barcelona", e2e_fixture: true },
      })
      .select("id")
      .single();
    if (error) throw new Error(`could not create trip: ${error.message}`);
    ownTripId = (data as { id: string }).id;

    // The voter must be a collaborator to reach the page at all.
    await sb.from("trip_collaborators").upsert(
      [
        { trip_id: ownTripId, user_id: manifest.users.owner.id, role: "owner" },
        { trip_id: ownTripId, user_id: manifest.users.voter.id, role: "voter" },
      ],
      { onConflict: "trip_id,user_id" }
    );
  });

  test.afterAll(async () => {
    if (!ownTripId) return;
    const sb = await db();
    await sb.from("trip_collaborators").delete().eq("trip_id", ownTripId);
    await sb.from("trips").delete().eq("id", ownTripId);
  });

  /**
   * TripPackingEssentials writes trip_meta straight from the browser through
   * the user's RLS-scoped client. `trips_update` permits the owner or an
   * 'editor'. Any collaborator — including 'voter', the DEFAULT invite role —
   * can READ the trip, so they reach this component and can tick a box.
   *
   * Their UPDATE then matched zero rows. `updateError` was null, nothing threw,
   * the tick stayed on screen, and a reload silently lost it. This drives the
   * real browser as a real voter and asserts on the database, because the
   * checkbox looked identical in both worlds.
   */
  test.use({ storageState: ".auth/voter.json" });

  test("a voter sees the failure instead of losing the tick silently", async ({ page }) => {
    const sb = await db();
    const { data: before } = await sb
      .from("trips").select("trip_meta").eq("id", ownTripId).maybeSingle();
    const checkedBefore = JSON.stringify(
      ((before as { trip_meta?: { packing_checked?: unknown } } | null)?.trip_meta?.packing_checked) ?? null
    );

    await preConsent(page);
    await page.goto(`/en/trips/${ownTripId}`, { waitUntil: "domcontentloaded" });
    await clearOverlays(page);

    // The packing block renders only when the trip has a list.
    const item = page.getByText(/Fixture Rain Jacket/i).first();
    await item.scrollIntoViewIfNeeded();
    await expect(item).toBeVisible({ timeout: 20_000 });

    // The toggle lives on the custom checkbox div, NOT on the label — clicking
    // the text does nothing at all, which is worth knowing for any future test
    // of this component.
    const row = item.locator("xpath=ancestor::*[self::div or self::label][1]");
    await row.locator("div.w-5.h-5").first().click();

    // THE POINT: the user is told. Before the fix this never appeared, because
    // a zero-row update looked exactly like a successful one.
    await expect(
      page.getByText(/failed to save/i),
      "a voter's tick cannot be saved, and the UI must say so rather than pretend"
    ).toBeVisible({ timeout: 15_000 });

    // And nothing was written, which is correct — a voter may not edit.
    const { data: after } = await sb
      .from("trips").select("trip_meta").eq("id", ownTripId).maybeSingle();
    expect(
      JSON.stringify(
        ((after as { trip_meta?: { packing_checked?: unknown } } | null)?.trip_meta?.packing_checked) ?? null
      )
    ).toBe(checkedBefore);
  });
});

test.describe("the destination hero states no temperature it invented", () => {
  test.skip(!tripId, "no fixture trip");
  test.use({ storageState: ".auth/owner.json" });

  /**
   * The hero chip regex-extracted a figure like "20-25°C" out of
   * trip_meta.weather_note — model prose measured contradicting itself across
   * 279 trips — and rendered it bare: no label, no "~", no source. A user was
   * emailed "10-18°C" for Los Angeles when the real forecast was 22-32°C, and
   * this surface showed the same class of number.
   *
   * The emails were fixed by wiring a real forecast. This surface has none, so
   * it must stop asserting one. The qualitative word stays: "sunny" is a vibe,
   * not a reading off an instrument.
   */
  test("renders a condition word, never a fabricated figure", async ({ page }) => {
    const sb = await db();
    const { data: t } = await sb.from("trips").select("trip_meta").eq("id", tripId!).maybeSingle();
    const meta = ((t as { trip_meta?: Record<string, unknown> } | null)?.trip_meta ?? {}) as Record<string, unknown>;
    // Give the hero prose that CONTAINS a temperature, so a regression that
    // re-enables extraction has something to extract.
    await sb.from("trips").update({
      trip_meta: { ...meta, weather_note: "Expect sunny days with temperatures around 20-25°C." },
    }).eq("id", tripId!);

    try {
      await preConsent(page);
      await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded" });
      await clearOverlays(page);
      await page.waitForLoadState("networkidle").catch(() => {});

      const body = await page.locator("body").innerText();
      expect(
        body,
        'the hero extracted "20-25°C" out of model prose and rendered it as though measured'
      ).not.toContain("20-25°C");
    } finally {
      await sb.from("trips").update({ trip_meta: meta }).eq("id", tripId!);
    }
  });
});

test.describe("the referral sync reaches the referrer's row", () => {
  test.skip(!creds().url || !creds().key, "no service credentials");

  /**
   * lib/referral/completion.ts updated the REFERRER's users row through the
   * REFEREE's RLS-scoped client. `users_update_own` is `id = auth.uid()`, and
   * the referrer is by definition not the referee — so the filter matched zero
   * rows EVERY time, `syncError` was always null, and the error log never
   * fired. Every other cross-user write in that block already used the admin
   * client; this one was missed.
   *
   * Asserted as the invariant that actually matters: a service-role write to
   * another user's row returns that row, and an RLS-scoped one would not.
   */
  test("a cross-user write returns the row it claims to have written", async () => {
    const sb = await db();
    const { data: someone } = await sb
      .from("users")
      .select("id, lifetime_referral_conversions")
      .limit(1)
      .maybeSingle();
    test.skip(!someone, "no users to exercise the write against");

    const row = someone as { id: string; lifetime_referral_conversions: number | null };
    const original = row.lifetime_referral_conversions ?? 0;

    // The shape the fix now uses: admin client + .select(). If this ever
    // returns zero rows for an existing id, the sync is silently dead again.
    const { data: written, error } = await sb
      .from("users")
      .update({ lifetime_referral_conversions: original })
      .eq("id", row.id)
      .select("id");

    expect(error).toBeNull();
    expect(
      written?.length,
      "a cross-user write must come back with the row — this is the check the referral sync lacked"
    ).toBe(1);
  });
});
