import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/**
 * A signed-in user whose PostHog never loads must still keep their trip.
 *
 * WHAT THIS REPRODUCES
 * --------------------
 * /trips/new had two persistence paths behind one three-state flag:
 *
 *   auto-save-v1 === true       useAutoSaveTrip persists every generation
 *   auto-save-v1 === false      hook inert; the post-auth redemption effect runs
 *   auto-save-v1 === undefined  NEITHER ran
 *
 * undefined is not a transient loading state. Analytics consent declined, an ad
 * blocker, or a failed PostHog request leave it undefined permanently — there is
 * no later evaluation to wait for. Those users generated an itinerary and
 * nothing wrote it down.
 *
 * Measured 2026-09-01, before the fix: 30 users burned 44 successful
 * generations and finished with ZERO trips. Among users who reached generation,
 * the ones who lost it were half as likely to have analytics consent
 * (36.7% vs 69.9%) — the signature of an unresolved flag, not of a user who
 * changed their mind. auto-save-v1 has been at rollout 100% since 2026-07-02,
 * so ON was the intended behaviour for all of them.
 *
 * WHY IT ASSERTS ON THE DATABASE
 * ------------------------------
 * The wizard renders the itinerary on screen either way. Only a trips row
 * distinguishes "saved" from "shown once and lost" — which is exactly why this
 * went unnoticed: it looks like it worked.
 *
 * REQUIRES
 *   npx tsx scripts/e2e-fixtures.mts --seed
 *   BASE_URL=http://localhost:3001 npx tsx scripts/e2e-login.mts
 *   BASE_URL=http://localhost:3001 npx playwright test autosave-unresolved-flag
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
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

function ownerId(): string {
  const raw = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const id = raw.owner?.id ?? raw.users?.owner?.id ?? raw.owner?.userId;
  if (!id) throw new Error("owner id missing from " + MANIFEST);
  return id as string;
}

test.describe("auto-save survives an unresolved PostHog flag", () => {
  test.skip(
    !existsSync(MANIFEST) || !existsSync(".auth/owner.json"),
    "run e2e-fixtures --seed and e2e-login first"
  );

  test.use({ storageState: ".auth/owner.json" });

  test("signed-in generation is persisted with PostHog blocked", async ({
    page,
  }) => {
    test.setTimeout(240_000); // AI generation is allowed up to 120s server-side

    const { url, key } = creds();
    test.skip(!url || !key, "service credentials unavailable");
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const uid = ownerId();

    const before = await db
      .from("trips")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid);

    // Make PostHog unreachable, exactly as an ad blocker or a consent-gated
    // session does. useFeatureFlagEnabled then stays undefined forever.
    await page.route("**://*.posthog.com/**", (r) => r.abort());
    await page.route("**://*.i.posthog.com/**", (r) => r.abort());
    await page.route("**/ingest/**", (r) => r.abort());

    await page.goto("/trips/new?destination=Lisbon");

    // Prove the precondition rather than assuming it: the flag must be
    // unresolved, otherwise this test would pass for the wrong reason.
    const flagState = await page.evaluate(() => {
      const ph = (window as unknown as { posthog?: { getFeatureFlag?: (k: string) => unknown } }).posthog;
      if (!ph || typeof ph.getFeatureFlag !== "function") return "posthog-absent";
      const v = ph.getFeatureFlag("auto-save-v1");
      return v === undefined ? "undefined" : String(v);
    });
    expect(
      ["undefined", "posthog-absent"],
      `flag must be unresolved for this test to mean anything, got ${flagState}`
    ).toContain(flagState);

    // Decline analytics on the consent banner. This is not incidental — it is
    // the real-world path into the bug: essentials-only means no PostHog, which
    // means the flag never resolves.
    const essentialOnly = page.getByRole("button", { name: /essential only/i });
    if (await essentialOnly.isVisible().catch(() => false)) {
      await essentialOnly.click();
      await page.waitForTimeout(500);
    }

    // Drive the wizard the way a person does.
    const dest = page.getByRole("combobox").first();
    await expect(dest).toBeVisible({ timeout: 30_000 });
    if (!(await dest.inputValue())) {
      await dest.fill("Lisbon");
      await page.waitForTimeout(1000);
    }

    // Dates: the wizard offers duration presets instead of a date picker.
    const preset = page.getByRole("button", { name: /^5 days$/i }).first();
    await expect(preset).toBeVisible({ timeout: 15_000 });
    await preset.click();

    // Advance until a generate control appears, then run it.
    const generate = page
      .getByRole("button", { name: /generate|create my trip|plan my trip|build/i })
      .first();
    for (let i = 0; i < 4 && !(await generate.isVisible().catch(() => false)); i++) {
      const next = page.getByRole("button", { name: /continue|next/i }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await page.waitForTimeout(2000);
    }
    await expect(generate).toBeVisible({ timeout: 30_000 });
    await generate.click();

    // The itinerary appearing is NOT the assertion — it renders either way.
    // Poll the database for the row that only exists if persistence ran.
    let after = before.count ?? 0;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const r = await db
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid);
      after = r.count ?? 0;
      if (after > (before.count ?? 0)) break;
      await page.waitForTimeout(3000);
    }

    expect(
      after,
      "the generated trip was never written — auto-save did not run for an " +
        "unresolved flag, which is the defect this guards"
    ).toBeGreaterThan(before.count ?? 0);

    // Clean up the trip this test created so the fixture teardown stays exact.
    const { data: mine } = await db
      .from("trips")
      .select("id, created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1);
    if (mine?.[0]?.id) await db.from("trips").delete().eq("id", mine[0].id);
  });
});
