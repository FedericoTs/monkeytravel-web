/**
 * The trip's expense ledger, as the owner sees it on the trip page: the
 * expenses logged so far, Settle up's transfers between the crew, and an
 * expense added through the form, then removed with Undo in between.
 *
 * The ledger shows before and after a trip (a live trip opens on Today), so
 * every test gets a trip of its own a few weeks out, with the fixture owner,
 * editor and voter on it and one expense paid by the owner and split three
 * ways. The trip is removed afterwards.
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json npx playwright test tests/e2e/expense-ledger.spec.ts --project=chromium
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;
const MANIFEST = ".auth/e2e-fixtures.json";

type Users = Record<"owner" | "mate" | "voter", { id: string; name: string }>;
const users: Users | null = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")).users : null;
const ROLES = { owner: "owner", mate: "editor", voter: "voter" } as const;

function iso(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
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

async function openTrip(page: Page, tripId: string) {
  await page.addInitScript((id) => {
    localStorage.setItem(`share_prompt_dismissed:${id}`, "1");
    localStorage.setItem("mt_ai_assistant_seen", String(Date.now()));
  }, tripId);
  await page.goto(`/en/trips/${tripId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await declineConsent(page);
  const ledger = page.getByRole("region", { name: "Trip expenses" });
  await expect(ledger).toBeVisible({ timeout: 60_000 });
  return ledger;
}

test.describe("expense ledger", () => {
  test.skip(!SUPA_URL || !SERVICE_KEY || !AUTH_STATE || !users, "run e2e-fixtures --seed and e2e-login, and set KEY_FLOWS_AUTH_STATE");
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 150_000 });

  let admin: SupabaseClient;
  let tripId: string;

  test.beforeEach(async () => {
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    tripId = randomUUID();
    const { error } = await admin.from("trips").insert({
      id: tripId,
      user_id: users!.owner.id,
      title: "E2E expense ledger (safe to delete)",
      description: "Automated E2E fixture. Safe to delete.",
      start_date: iso(40),
      end_date: iso(41),
      status: "planning",
      visibility: "private",
      itinerary: [
        {
          day_number: 1,
          date: iso(40),
          title: "Riverside",
          activities: [
            { id: "x-d1a1", name: "Bridge walk", start_time: "10:00", duration_minutes: 60, type: "landmark", location: "Riverside" },
          ],
        },
      ],
      trip_meta: { destination: "Porto", e2e_fixture: true },
    });
    if (error) throw error;
    const { error: crewError } = await admin
      .from("trip_collaborators")
      .insert((Object.keys(ROLES) as (keyof typeof ROLES)[]).map((key) => ({ trip_id: tripId, user_id: users![key].id, role: ROLES[key] })));
    if (crewError) throw crewError;

    const expenseId = randomUUID();
    const { error: expenseError } = await admin.from("trip_expenses").insert({
      id: expenseId,
      trip_id: tripId,
      amount: 90,
      currency: "EUR",
      category: "food",
      spent_on: iso(40),
      paid_by_user_id: users!.owner.id,
      description: "Ledger dinner",
    });
    if (expenseError) throw expenseError;
    const { error: splitError } = await admin
      .from("trip_expense_splits")
      .insert((Object.keys(ROLES) as (keyof typeof ROLES)[]).map((key) => ({ expense_id: expenseId, user_id: users![key].id, share_amount: 30 })));
    if (splitError) throw splitError;
  });

  test.afterEach(async () => {
    if (tripId) await admin.from("trips").delete().eq("id", tripId);
  });

  test("lists the trip's expenses, and Settle up shows who pays whom", async ({ page }) => {
    const ledger = await openTrip(page, tripId);
    await expect(ledger.getByText("Ledger dinner")).toBeVisible({ timeout: 30_000 });

    await ledger.getByRole("button", { name: "Settle up" }).click();
    const settle = page.getByRole("dialog", { name: "Settle Up" });
    await expect(settle).toBeVisible({ timeout: 20_000 });
    await expect(settle.getByText("2 transfers to close out")).toBeVisible({ timeout: 20_000 });
    for (const debtor of [users!.mate.name, users!.voter.name]) {
      await expect(settle.getByText(new RegExp(`${debtor}\\s+owes\\s+${users!.owner.name}`))).toBeVisible();
    }
  });

  test("an expense added through the form is saved, and removing it can be undone", async ({ page }) => {
    const ledger = await openTrip(page, tripId);
    await ledger.getByRole("button", { name: "Add expense" }).click();
    await ledger.getByLabel("Amount").fill("42");
    await ledger.getByLabel("Description").fill("Ledger taxi");
    await ledger.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Expense added.")).toBeVisible({ timeout: 20_000 });
    await expect(ledger.getByText("Ledger taxi")).toBeVisible();

    const taxiRows = async () => {
      const { data, error } = await admin.from("trip_expenses").select("amount").eq("trip_id", tripId).eq("description", "Ledger taxi");
      if (error) throw error;
      return (data ?? []).map((r) => Number(r.amount));
    };
    expect(await taxiRows()).toEqual([42]);

    const deleteTaxi = () =>
      ledger.getByRole("listitem").filter({ hasText: "Ledger taxi" }).getByRole("button", { name: "Delete this expense" }).click();
    await deleteTaxi();
    await expect(ledger.getByText("Ledger taxi")).toHaveCount(0);
    // The toast that says it was removed carries the Undo.
    await page.getByText("Expense removed.").locator("xpath=ancestor::div[.//button][1]").getByRole("button", { name: "Undo" }).click();
    await expect(ledger.getByText("Ledger taxi")).toBeVisible();
    expect(await taxiRows()).toEqual([42]);

    await deleteTaxi();
    await expect.poll(taxiRows, { timeout: 20_000 }).toEqual([]);
    await expect(ledger.getByText("Ledger dinner")).toBeVisible();
  });
});
