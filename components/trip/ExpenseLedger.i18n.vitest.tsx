/** @vitest-environment jsdom */
/**
 * The expense ledger's failures in the trip's language. The expenses route
 * explains in English for its logs ("You can only delete your own expenses"),
 * and that English used to be the toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itCommon from "@/messages/it/common.json";
import { ToastProvider } from "@/components/ui/Toast";
import { UNDO_WINDOW_MS } from "@/hooks/useUndoableRemoval";
import ExpenseLedger from "./ExpenseLedger";

vi.mock("@/components/trip/SettleUpView", () => ({ default: () => null }));
vi.mock("@/lib/observability/sentry", () => ({ sentry: async () => ({}) }));
vi.mock("@/lib/posthog/events", () => ({ captureExpenseAdded: async () => undefined, captureExpenseDeleted: async () => undefined }));

const row = {
  id: "e1",
  trip_id: "trip-1",
  created_by: "member-1",
  amount: 30,
  currency: "EUR",
  category: "food",
  description: "Cena",
  spent_on: "2026-10-02",
  created_at: "2026-10-02T20:00:00Z",
  updated_at: "2026-10-02T20:00:00Z",
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const copy = itCommon.expenses;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED", "true");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return json(403, { error: "You can only delete your own expenses" });
      if (init?.method === "POST") return json(500, { error: "Failed to create expense" });
      return json(200, { expenses: [row], currentUserId: "owner-1", isTripOwner: true });
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function openLedger() {
  render(
    <NextIntlClientProvider locale="it" messages={{ common: itCommon }}>
      <ToastProvider>
        <ExpenseLedger tripId="trip-1" />
      </ToastProvider>
    </NextIntlClientProvider>
  );
  await screen.findByText("Cena");
}

describe("ExpenseLedger in Italian", () => {
  it("says why a removal was refused, once Undo has gone", async () => {
    await openLedger();
    vi.useFakeTimers();
    fireEvent.click(screen.getByLabelText(copy.deleteAriaLabel));
    await act(async () => void (await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)));
    expect(screen.getByText(copy.errorDeleteNotYours)).toBeTruthy();
    expect(screen.queryByText(/delete your own/)).toBeNull();
  });

  it("reports a failed add in Italian, not the route's English", async () => {
    await openLedger();
    fireEvent.click(screen.getByText(copy.addButton));
    fireEvent.change(screen.getByLabelText(copy.fieldAmount), { target: { value: "12" } });
    fireEvent.click(screen.getByText(copy.save));
    expect(await screen.findByText(copy.errorAddFailed)).toBeTruthy();
    expect(screen.queryByText(/Failed to create/)).toBeNull();
  });
});
