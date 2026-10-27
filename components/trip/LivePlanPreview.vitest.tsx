import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import { LivePlanPreview } from "./LivePlanPreview";
import type { SseDayData } from "@/lib/streaming/sse";

/** The plan as it streams in: the days written so far, then the one being planned. */

const day = (n: number, theme: string, activities: unknown[]): SseDayData => ({
  day_number: n,
  date: `2027-03-1${n}`,
  theme,
  activities,
});

function renderPreview(days: SseDayData[], totalDays: number) {
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <LivePlanPreview days={days} totalDays={totalDays} />
    </NextIntlClientProvider>
  );
}

describe("LivePlanPreview", () => {
  it("shows each streamed day with its stops, then the day being planned", () => {
    renderPreview(
      [
        day(1, "Ancient wonders", [
          { name: "Acropolis of Athens", start_time: "09:00", location: "Acropolis" },
          { name: "Lunch in Plaka", start_time: "12:30" },
        ]),
      ],
      3
    );
    expect(screen.getByText("Day 1")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ancient wonders" })).toBeTruthy();
    expect(screen.getByText("09:00")).toBeTruthy();
    expect(screen.getByText("Acropolis of Athens")).toBeTruthy();
    expect(screen.getByText("· Acropolis")).toBeTruthy();
    expect(screen.getByText("Planning day 2…")).toBeTruthy();
  });

  it("skips what is not a stop and plans nothing past the last day", () => {
    renderPreview([day(1, "Arrival", [null, { start_time: "10:00" }, { name: "Check in" }])], 1);
    expect(screen.getByText("Check in")).toBeTruthy();
    expect(screen.queryByText("10:00")).toBeNull();
    expect(screen.queryByText(/Planning day/)).toBeNull();
  });
});
