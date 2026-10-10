/** @vitest-environment jsdom */
/**
 * The expense ledger's failures in the trip's language. The expenses route
 * explains in English for its logs ("You can only delete your own expenses"),
 * and that English used to be the toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itCommon from "@/messages/it/common.json";
import ExpenseLedger from "./ExpenseLedger";

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("@/components/trip/SettleUpView", () => ({ default: () => null }));
vi.mock("@/lib/observability/sentry", () => ({ sentry: () => Promise.reject(new Error("no sentry in tests")) }));
vi.mock("@/lib/posthog/events", () => ({ captureExpenseAdded: vi.fn(async () => {}), captureExpenseDeleted: vi.fn(async () => {}) }));

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

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const copy = itCommon.expenses;

beforeEach(() => {
  addToast.mockReset();
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function renderLedger() {
  return render(
    <NextIntlClientProvider locale="it" messages={{ common: itCommon }}>
      <ExpenseLedger tripId="trip-1" />
    </NextIntlClientProvider>
  );
}

describe("ExpenseLedger in Italian", () => {
  it("says why a removal was refused", async () => {
    renderLedger();
    fireEvent.click(await screen.findByLabelText(copy.deleteAriaLabel));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(copy.errorDeleteNotYours, "error"));
  });

  it("reports a failed add in Italian, not the route's English", async () => {
    renderLedger();
    await screen.findByLabelText(copy.deleteAriaLabel);
    fireEvent.click(screen.getByText(copy.addButton));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "12" } });
    fireEvent.click(screen.getByText(copy.save));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(copy.errorAddFailed, "error"));
  });
});
