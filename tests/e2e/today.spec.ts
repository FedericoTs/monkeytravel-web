/**
 * Live Trip Phase 3.2 — a live trip opens on Today.
 *
 * Self-contained: uses the service role to make a known trip live (dates
 * spanning today, an IANA timezone pinned to UTC so the middle day is
 * deterministically "today", a share token, an itinerary with timed
 * activities), runs an anonymous recipient against /shared/[token], then
 * restores the trip exactly. Skipped without service creds + a trip id.
 *
 * The admin setup and restore live INSIDE the test (try/finally), and the
 * anonymous recipient is the default `page` fixture — this describe sets no
 * storageState, so `page` has no session.
 *
 *   KEY_FLOWS_TRIP_ID=<fixture trip> BASE_URL=http://localhost:3001 \
 *     npx playwright test tests/e2e/today.spec.ts --project=chromium
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env: Record<string, string> = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const need = (k: string) => process.env[k] ?? env[k] ?? "";
const SUPA_URL = need("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;

function iso(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function liveItinerary() {
  return [
    { day_number: 1, date: iso(-1), title: "Yesterday", activities: [{ id: "t-d1a1", name: "Castle", start_time: "10:00", duration_minutes: 90, type: "landmark", location: "Alfama", address: "Alfama, Lisboa", coordinates: { lat: 38.7139, lng: -9.1335 } }] },
    { day_number: 2, date: iso(0), title: "Today", activities: [
      { id: "t-d2a1", name: "Jerónimos Monastery", start_time: "09:00", duration_minutes: 90, type: "landmark", location: "Belém", address: "Praça do Império, Lisboa", coordinates: { lat: 38.6979, lng: -9.2065 } },
      { id: "t-d2a2", name: "Sunset at LX Factory", start_time: "20:00", duration_minutes: 120, type: "nightlife", location: "Alcântara", address: "Alcântara, Lisboa", coordinates: { lat: 38.7028, lng: -9.1786 } },
    ] },
    { day_number: 3, date: iso(1), title: "Tomorrow", activities: [{ id: "t-d3a1", name: "Pena Palace", start_time: "10:00", duration_minutes: 150, type: "landmark", location: "Sintra", address: "Sintra", coordinates: { lat: 38.7876, lng: -9.3905 } }] },
  ];
}

async function declineConsent(page: Page) {
  const btn = page.getByRole("button", { name: /essential only|solo essenziali|solo esenciales|apenas essenciais/i });
  try {
    await btn.waitFor({ state: "visible", timeout: 4000 });
    await btn.click();
  } catch {
    /* already decided */
  }
}

test.describe("Today mode", () => {
  test.skip(!SUPA_URL || !SERVICE_KEY || !TRIP_ID, "set SUPABASE_SERVICE_ROLE_KEY + KEY_FLOWS_TRIP_ID");
  test.describe.configure({ timeout: 120_000 });

  test("a recipient lands on Today, then can open the full itinerary", async ({ page }) => {
    const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: original, error } = await admin
      .from("trips")
      .select("start_date, end_date, itinerary, trip_meta, share_token")
      .eq("id", TRIP_ID!)
      .single();
    expect(error, error?.message).toBeNull();

    const token = (original!.share_token as string) ?? randomUUID();
    const meta = { ...((original!.trip_meta as Record<string, unknown>) ?? {}), timezone: "UTC", destination: "Lisbon", packing_suggestions: ["Passport", "Charger", "Sunscreen"] };
    const { error: upErr } = await admin
      .from("trips")
      .update({ start_date: iso(-1), end_date: iso(1), itinerary: liveItinerary(), trip_meta: meta, share_token: token })
      .eq("id", TRIP_ID!);
    expect(upErr, upErr?.message).toBeNull();

    try {
      // domcontentloaded, not networkidle: Today re-renders on a timer.
      const r = await page.goto(`/shared/${token}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      expect(r?.status()).toBeLessThan(400);
      await declineConsent(page);

      const today = page.getByTestId("today-view");
      await today.waitFor({ state: "visible", timeout: 30_000 });

      const heading = (await today.locator("h2").first().textContent()) ?? "";
      expect(heading, `today header was "${heading}"`).toMatch(/2\s*\/\s*3|2 of 3|2 di 3|2 de 3/i);

      const highlight = (await page.getByTestId("today-highlight").textContent()) ?? "";
      expect(highlight).toMatch(/Jerónimos|LX Factory/);
      expect(highlight).not.toContain("Pena Palace");

      await page.getByTestId("today-view-full").click();
      await today.waitFor({ state: "hidden", timeout: 10_000 });
      const back = page.getByTestId("back-to-today");
      await back.waitFor({ state: "visible", timeout: 10_000 });
      await back.click();
      await today.waitFor({ state: "visible", timeout: 10_000 });

      // Phase 3.3: tap "Skip this" on the highlighted activity; the overlay
      // shows it struck. A double-tap is a no-op then a toggle-off, so tap once.
      const skipChip = page.getByTestId("today-highlight").getByTestId("chip-skip");
      await skipChip.click();
      const struck = page.getByTestId("today-highlight").locator(".line-through");
      await struck.waitFor({ state: "visible", timeout: 15_000 });

      // The change is shared and server-side, not local component state: after a
      // full reload the skip is still there (it lives in trip_today_actions, read
      // on load — the owner's itinerary is untouched). This is what every other
      // viewer sees; realtime just delivers it without the reload.
      await page.reload({ waitUntil: "domcontentloaded" });
      await declineConsent(page);
      await page.getByTestId("today-view").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("today-highlight").locator(".line-through").waitFor({ state: "visible", timeout: 15_000 });

      // Phase 3.4: the "Packed?" checklist is present (collapsed on day 2);
      // expanding it reveals the trip's packing items, and ticking one persists.
      const packing = page.getByTestId("today-packing");
      await packing.waitFor({ state: "visible", timeout: 10_000 });
      await packing.getByRole("button").first().click(); // expand
      const firstItem = page.getByTestId("today-packing-item").first();
      await firstItem.waitFor({ state: "visible", timeout: 5_000 });
      await firstItem.click();
      await expect(page.getByTestId("today-packing-progress")).toContainText(/1\s*\/\s*3/);

      // Phase 3.4 expenses: add one via the day-level "Who paid?"; the summary
      // then shows the amount split across the cohort (here: owner + this payer).
      const panel = page.getByTestId("today-expenses");
      await panel.waitFor({ state: "visible", timeout: 10_000 });
      await panel.getByTestId("expense-add-open").click();
      await page.getByTestId("expense-amount").fill("30");
      await page.getByTestId("expense-save").click();
      await expect(page.getByTestId("expense-summary")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("expense-list")).toContainText(/30/);
    } finally {
      await admin.from("trip_expenses").delete().eq("trip_id", TRIP_ID!);
      await admin.from("trip_today_actions").delete().eq("trip_id", TRIP_ID!);
      await admin
        .from("trips")
        .update({
          start_date: original!.start_date,
          end_date: original!.end_date,
          itinerary: original!.itinerary,
          trip_meta: original!.trip_meta,
          share_token: original!.share_token,
        })
        .eq("id", TRIP_ID!);
    }
  });
});
