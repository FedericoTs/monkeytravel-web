/** @vitest-environment jsdom */
/**
 * The ledger reads a typed amount like Today does, in the app's language: a
 * number field read "1.200" as 1.2 in Italian. One that could mean two things
 * is asked about before anything is saved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ExpenseLedger from "./ExpenseLedger";

const intl = vi.hoisted(() => ({
  locale: "it",
  // Stable like next-intl's: the ledger reloads when it changes.
  t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
const addToast = vi.hoisted(() => vi.fn());
vi.mock("next-intl", () => ({ useTranslations: () => intl.t, useLocale: () => intl.locale }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("@/components/trip/SettleUpView", () => ({ default: () => null }));
vi.mock("@/lib/observability/sentry", () => ({ sentry: async () => ({}) }));
vi.mock("@/lib/posthog/events", () => ({ captureExpenseAdded: async () => undefined, captureExpenseDeleted: async () => undefined }));

let posted: Array<Record<string, unknown>> = [];

beforeEach(() => {
  posted = [];
  addToast.mockReset();
  vi.stubEnv("NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED", "true");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posted.push(body);
        const expense = { id: "exp-1", trip_id: "trip-1", created_by: "user-1", description: null, spent_on: "2026-10-10", created_at: "", updated_at: "", ...body };
        return new Response(JSON.stringify({ expense }), { status: 200 });
      }
      return new Response(JSON.stringify({ expenses: [], currentUserId: "user-1", isTripOwner: true }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function typeAndSave(locale: string, value: string) {
  intl.locale = locale;
  render(<ExpenseLedger tripId="trip-1" />);
  fireEvent.click(await screen.findByText("addButton"));
  const input = screen.getByLabelText("fieldAmount");
  expect(input.getAttribute("type")).toBe("text");
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByText("save"));
}

describe("ExpenseLedger amount", () => {
  it.each([
    ["it", "1.200", 1200],
    ["pt", "1.200,50", 1200.5],
    ["en", "1,500", 1500],
    ["en", "12,50", 12.5],
  ])("%s: %s is saved as %s", async (locale, typed, saved) => {
    await typeAndSave(locale, typed);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].amount).toBe(saved);
  });

  it("asks which amount was meant, then saves the one picked", async () => {
    await typeAndSave("en", "1.200");
    const choices = screen.getByTestId("amount-choices");
    expect(posted).toEqual([]);
    fireEvent.click(within(choices).getByRole("button", { name: "1.20" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].amount).toBe(1.2);
  });

  it("says how to write an amount it can't read", async () => {
    await typeAndSave("it", "12 50");
    expect(addToast).toHaveBeenCalledWith(`amountInvalid {"example":"12,50"}`, "error");
    expect(posted).toEqual([]);
  });
});
