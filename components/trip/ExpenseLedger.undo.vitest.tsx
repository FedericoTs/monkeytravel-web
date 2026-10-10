/** @vitest-environment jsdom */
/**
 * Deleting from the ledger waits behind a toast with Undo before the delete
 * is sent; the totals leave the row out meanwhile. A delete that fails puts
 * the row back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ExpenseLedger from "./ExpenseLedger";
import { ToastProvider } from "@/components/ui/Toast";
import { UNDO_WINDOW_MS } from "@/hooks/useUndoableRemoval";

const intl = vi.hoisted(() => ({
  // Stable like next-intl's: the ledger reloads when it changes.
  t: (key: string) => key,
}));
vi.mock("next-intl", () => ({ useTranslations: () => intl.t, useLocale: () => "en" }));
vi.mock("@/components/trip/SettleUpView", () => ({ default: () => null }));
vi.mock("@/lib/observability/sentry", () => ({ sentry: async () => ({}) }));
vi.mock("@/lib/posthog/events", () => ({ captureExpenseAdded: async () => undefined, captureExpenseDeleted: async () => undefined }));

const row = (id: string, amount: number, description: string) => ({
  id,
  trip_id: "trip-1",
  created_by: "user-1",
  amount,
  currency: "EUR",
  category: "food",
  description,
  spent_on: "2026-10-09",
  created_at: "2026-10-09T10:00:00Z",
  updated_at: "2026-10-09T10:00:00Z",
});

let deleted: unknown[] = [];
let deleteStatus = 200;

beforeEach(() => {
  deleted = [];
  deleteStatus = 200;
  vi.stubEnv("NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED", "true");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(deleteStatus === 200 ? { deleted: true } : {}), { status: deleteStatus });
      }
      const expenses = [row("exp-1", 30, "Dinner"), row("exp-2", 12, "Gelato")];
      return new Response(JSON.stringify({ expenses, currentUserId: "user-1", isTripOwner: true }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function openLedger() {
  render(
    <ToastProvider>
      <ExpenseLedger tripId="trip-1" />
    </ToastProvider>,
  );
  await screen.findByText("Dinner");
  // Fake timers only once the ledger has loaded: the loading wait uses real ones.
  vi.useFakeTimers();
}

const deleteDinner = () => fireEvent.click(screen.getAllByRole("button", { name: "deleteAriaLabel" })[0]);
const endUndoWindow = () => act(async () => void (await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)));

describe("ExpenseLedger delete", () => {
  it("hides the row and leaves it out of the totals until Undo", async () => {
    await openLedger();
    expect(screen.getByText("€42.00")).toBeTruthy();
    deleteDinner();
    expect(screen.queryByText("Dinner")).toBeNull();
    expect(screen.getByText("€12.00", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("toastDeleted")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(screen.getByText("Dinner")).toBeTruthy();
    expect(screen.getByText("€42.00")).toBeTruthy();
    await endUndoWindow();
    expect(deleted).toEqual([]);
  });

  it("sends the delete once Undo has gone", async () => {
    await openLedger();
    deleteDinner();
    expect(deleted).toEqual([]);
    await endUndoWindow();
    expect(deleted).toEqual([{ id: "exp-1" }]);
    expect(screen.queryByText("Dinner")).toBeNull();
    expect(screen.getByText("Gelato")).toBeTruthy();
  });

  it("puts the row back when the delete fails", async () => {
    deleteStatus = 500;
    await openLedger();
    deleteDinner();
    await endUndoWindow();
    expect(deleted).toEqual([{ id: "exp-1" }]);
    expect(screen.getByText("Dinner")).toBeTruthy();
    expect(screen.getByText("errorDeleteFailed")).toBeTruthy();
  });
});
