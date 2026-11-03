/**
 * The trip's expense ledger, as the owner sees it on the trip page: the
 * expenses logged so far, Settle up's transfers between the crew, and an
 * expense added through the form, then removed with Undo in between.
 *
 * Runs on the fixture trip, whose owner, editor and voter share the costs.
 * Each test starts from one expense of its own, paid by the owner and split
 * three ways, and leaves none behind.
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *     npx playwright test tests/e2e/expense-ledger.spec.ts --project=chromium
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
const TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;
const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;
const MANIFEST = ".auth/e2e-fixtures.json";

type Users = Record<"owner" | "mate" | "voter", { id: string; name: string }>;
const users: Users | null = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")).users : null;

async function declineConsent(page: Page) {
  const btn = page.getByRole("button", { name: /essential only|solo essenziali|solo esenciales|apenas essenciais/i });
  try {
    await btn.waitFor({ state: "visible", timeout: 4000 });
    await btn.click();
  } catch {
    /* already decided */
  }
}

async function openTrip(page: Page) {
  await page.addInitScript((id) => {
    localStorage.setItem(`share_prompt_dismissed:${id}`, "1");
    localStorage.setItem("mt_ai_assistant_seen", String(Date.now()));
  }, TRIP_ID!);
  await page.goto(`/en/trips/${TRIP_ID}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await declineConsent(page);
  const ledger = page.getByRole("region", { name: "Trip expenses" });
  await expect(ledger).toBeVisible({ timeout: 60_000 });
  return ledger;
}

test.describe("expense ledger", () => {
  test.skip(!SUPA_URL || !SERVICE_KEY || !TRIP_ID || !AUTH_STATE || !users, "run e2e-fixtures --seed and e2e-login, and set KEY_FLOWS_*");
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 150_000 });

  let admin: SupabaseClient;
  const clear = async () => {
    const { error } = await admin.from("trip_expenses").delete().eq("trip_id", TRIP_ID!);
    if (error) throw error;
  };

  test.beforeEach(async () => {
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    await clear();
    const id = randomUUID();
    const { error } = await admin.from("trip_expenses").insert({
      id,
      trip_id: TRIP_ID,
      amount: 90,
      currency: "EUR",
      category: "food",
      spent_on: new Date().toISOString().slice(0, 10),
      paid_by_user_id: users!.owner.id,
      description: "Ledger dinner",
    });
    if (error) throw error;
    const { error: splitError } = await admin
      .from("trip_expense_splits")
      .insert((["owner", "mate", "voter"] as const).map((role) => ({ expense_id: id, user_id: users![role].id, share_amount: 30 })));
    if (splitError) throw splitError;
  });

  test.afterEach(async () => {
    await clear();
  });

  test("lists the trip's expenses, and Settle up shows who pays whom", async ({ page }) => {
    const ledger = await openTrip(page);
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
    const ledger = await openTrip(page);
    await ledger.getByRole("button", { name: "Add expense" }).click();
    await ledger.getByLabel("Amount").fill("42");
    await ledger.getByLabel("Description").fill("Ledger taxi");
    await ledger.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Expense added.")).toBeVisible({ timeout: 20_000 });
    await expect(ledger.getByText("Ledger taxi")).toBeVisible();

    const taxiRows = async () => {
      const { data, error } = await admin.from("trip_expenses").select("amount").eq("trip_id", TRIP_ID!).eq("description", "Ledger taxi");
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
