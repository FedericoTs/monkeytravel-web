/** @vitest-environment jsdom */
/**
 * Mid-trip, Settle Up is reachable from Today's expense panel: the ledger
 * that also has it sits in the planning view, which a live trip hides. Only
 * the trip page offers it, since Settle Up is for the trip's members.
 * Removing a payment waits behind a toast with Undo before it is sent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TodayExpenses from "./TodayExpenses";
import { ToastProvider } from "@/components/ui/Toast";
import { UNDO_WINDOW_MS } from "@/hooks/useUndoableRemoval";
import type { ExpensePublic, ExpenseSummary } from "@/lib/expenses/shared";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/components/trip/ExpenseQuickAdd", () => ({ default: () => null }));

const expense: ExpensePublic = {
  id: "e1",
  activityId: null,
  amountCents: 3000,
  currency: "EUR",
  category: "food",
  description: null,
  paidByName: "Ana",
  paidByIsOwner: false,
  mine: false,
  createdAt: "2026-10-02T10:00:00Z",
  splits: [],
};
const summary: ExpenseSummary = { currency: "EUR", totalCents: 3000, youPaidCents: 0, youOweCents: 1000, netCents: -1000, count: 1 };

const panel = ({ onSettleUp, onRemove = async () => true, expenses = [expense] }: { onSettleUp?: () => void; onRemove?: (id: string) => Promise<boolean>; expenses?: ExpensePublic[] } = {}) =>
  render(
    <ToastProvider>
      <TodayExpenses
        expenses={expenses}
        summary={summary}
        busy={false}
        error={null}
        onAdd={async () => true}
        onRemove={onRemove}
        activityName={() => null}
        onSettleUp={onSettleUp}
      />
    </ToastProvider>,
  );

afterEach(() => vi.useRealTimers());

describe("TodayExpenses", () => {
  it("opens Settle Up from the summary on the trip page", () => {
    const onSettleUp = vi.fn();
    panel({ onSettleUp });
    fireEvent.click(screen.getByTestId("today-settle-up"));
    expect(onSettleUp).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("today-settle-up").textContent).toBe("expenses.settle.openButton");
  });

  it("offers no Settle Up where it isn't passed, like the share link", () => {
    panel();
    expect(screen.queryByTestId("today-settle-up")).toBeNull();
  });

  it("hides a removed payment at once and sends nothing if you undo", async () => {
    vi.useFakeTimers();
    const onRemove = vi.fn(async () => true);
    panel({ onRemove, expenses: [{ ...expense, mine: true }, { ...expense, id: "e2" }] });
    fireEvent.click(screen.getByText("today.expenses.remove"));
    expect(screen.getAllByText("Ana")).toHaveLength(1);
    expect(screen.getByText("expenses.toastDeleted")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "expenses.undo" }));
    expect(screen.getAllByText("Ana")).toHaveLength(2);
    await act(async () => void (await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)));
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("sends the removal once Undo has gone", async () => {
    vi.useFakeTimers();
    const onRemove = vi.fn(async () => true);
    panel({ onRemove, expenses: [{ ...expense, mine: true }] });
    fireEvent.click(screen.getByText("today.expenses.remove"));
    expect(screen.queryByTestId("expense-list")).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();

    await act(async () => void (await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("e1", { keepalive: false });
  });

  it("words a failed payment from today.errors, not from the route's English", () => {
    render(
      <ToastProvider>
        <TodayExpenses
          expenses={[]}
          summary={null}
          busy={false}
          error="amount"
          onAdd={async () => false}
          onRemove={async () => true}
          activityName={() => null}
        />
      </ToastProvider>,
    );
    expect(screen.getByText("today.errors.amount")).toBeTruthy();
  });
});
