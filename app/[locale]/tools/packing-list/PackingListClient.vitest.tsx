/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itTools from "@/messages/it/tools.json";
import PackingListClient from "./PackingListClient";

/** A list that can't be made says why, in the traveller's language where it can. */

const words = itTools.packingList;

vi.mock("@/lib/i18n/routing", () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
// The form's own date picker is covered elsewhere; here the dates are simply chosen.
vi.mock("@/components/ui/DateRangePicker", () => ({
  default: ({ onStartDateChange, onEndDateChange }: { onStartDateChange: (d: string) => void; onEndDateChange: (d: string) => void }) => (
    <button
      type="button"
      onClick={() => {
        onStartDateChange("2027-05-10");
        onEndDateChange("2027-05-12");
      }}
    >
      choose dates
    </button>
  ),
}));

function answers(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

async function ask() {
  render(
    <NextIntlClientProvider locale="it" messages={{ tools: itTools }}>
      <PackingListClient locale="it" />
    </NextIntlClientProvider>
  );
  fireEvent.change(screen.getByPlaceholderText(words.destinationPlaceholder), { target: { value: "Roma" } });
  fireEvent.click(screen.getByRole("button", { name: "choose dates" }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(words.generate) }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a packing list that can't be made", () => {
  it("says so when the model is out of service", async () => {
    answers(503, { error: "The trip planner is temporarily unavailable", code: "MODEL_OUTAGE" });
    await ask();
    expect(await screen.findByText(words.errorModelOutage)).toBeTruthy();
  });

  it("names the hourly limit", async () => {
    answers(429, { error: "Free hourly limit reached.", code: "RATE_LIMIT" });
    await ask();
    expect(await screen.findByText(words.rateLimitMessage)).toBeTruthy();
  });
});
