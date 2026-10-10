/** @vitest-environment jsdom */
/**
 * "Who paid?" reads the amount in the app's language and sends the server one
 * form only ("1200.00"). One that could mean two things is asked about, not
 * guessed: "1.200" is twelve hundred in Italian, "1,200" there could be either.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { formatAmount } from "@/lib/expenses/shared";
import ExpenseQuickAdd from "./ExpenseQuickAdd";

const intl = vi.hoisted(() => ({ locale: "it" }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
  useLocale: () => intl.locale,
}));

function typeAndSave(locale: string, value: string) {
  intl.locale = locale;
  const onAdd = vi.fn(async () => true);
  render(<ExpenseQuickAdd onAdd={onAdd} busy={false} />);
  fireEvent.click(screen.getByTestId("expense-add-open"));
  fireEvent.change(screen.getByTestId("expense-amount"), { target: { value } });
  fireEvent.click(screen.getByTestId("expense-save"));
  return onAdd;
}

describe("ExpenseQuickAdd", () => {
  it.each([
    ["it", "1.200", "1200.00"],
    ["es", "1.200", "1200.00"],
    ["pt", "R$ 1.200,50", "1200.50"],
    ["en", "1,500", "1500.00"],
    ["en", "12,50", "12.50"],
    ["it", "12.50", "12.50"],
  ])("%s: %s is sent as %s", async (locale, typed, sent) => {
    const onAdd = typeAndSave(locale, typed);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(sent));
    expect(screen.queryByTestId("amount-choices")).toBeNull();
  });

  it("asks which amount was meant instead of guessing, and sends the one picked", async () => {
    const onAdd = typeAndSave("it", "1,200");
    const choices = screen.getByTestId("amount-choices");
    expect(onAdd).not.toHaveBeenCalled();
    expect(within(choices).getAllByRole("button").map((b) => b.textContent)).toEqual([formatAmount(120000, "it"), formatAmount(120, "it")]);

    fireEvent.click(within(choices).getByRole("button", { name: formatAmount(120, "it") }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("1.20"));
  });

  it("can pick the thousands reading too", async () => {
    const onAdd = typeAndSave("en", "1.200");
    fireEvent.click(within(screen.getByTestId("amount-choices")).getByRole("button", { name: "1,200.00" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("1200.00"));
  });

  it("drops the question once the amount is edited", () => {
    typeAndSave("it", "1,200");
    fireEvent.change(screen.getByTestId("expense-amount"), { target: { value: "1.200" } });
    expect(screen.queryByTestId("amount-choices")).toBeNull();
  });

  it.each(["-5", "12 50", "1,5000", "0"])("says how to write %s instead of sending it", (typed) => {
    const onAdd = typeAndSave("it", typed);
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(`expenses.amountInvalid {"example":"12,50"}`);
  });
});
