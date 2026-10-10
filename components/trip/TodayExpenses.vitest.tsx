/** @vitest-environment jsdom */
/**
 * Mid-trip, Settle Up is reachable from Today's expense panel: the ledger
 * that also has it sits in the planning view, which a live trip hides. Only
 * the trip page offers it, since Settle Up is for the trip's members.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import TodayExpenses from "./TodayExpenses";
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

const panel = (onSettleUp?: () => void) =>
  render(
    <TodayExpenses
      expenses={[expense]}
      summary={summary}
      busy={false}
      error={null}
      onAdd={async () => true}
      onRemove={() => undefined}
      activityName={() => null}
      onSettleUp={onSettleUp}
    />,
  );

describe("TodayExpenses", () => {
  it("opens Settle Up from the summary on the trip page", () => {
    const onSettleUp = vi.fn();
    panel(onSettleUp);
    fireEvent.click(screen.getByTestId("today-settle-up"));
    expect(onSettleUp).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("today-settle-up").textContent).toBe("expenses.settle.openButton");
  });

  it("offers no Settle Up where it isn't passed, like the share link", () => {
    panel();
    expect(screen.queryByTestId("today-settle-up")).toBeNull();
  });

  it("words a failed payment from today.errors, not from the route's English", () => {
    render(
      <TodayExpenses
        expenses={[]}
        summary={null}
        busy={false}
        error="amount"
        onAdd={async () => false}
        onRemove={() => undefined}
        activityName={() => null}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("today.errors.amount");
  });
});
