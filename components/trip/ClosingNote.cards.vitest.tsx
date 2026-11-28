import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";

vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `${from} ${amount}` }) }),
}));
vi.mock("@/lib/stats/useSavedTrips", () => ({ useSavedTrips: () => null }));

import ActivityCard from "@/components/ActivityCard";
import EditableActivityCard from "./EditableActivityCard";

const louvre: Activity = {
  id: "a1",
  time_slot: "morning",
  start_time: "09:30",
  duration_minutes: 150,
  name: "Louvre Museum",
  type: "museum",
  description: "The world's largest art museum.",
  location: "1st arrondissement",
  tips: [],
  booking_required: true,
  estimated_cost: { amount: 22, currency: "EUR", tier: "moderate" },
  closing: { dates: ["2026-12-15"], source: "https://www.louvre.fr/en/visit/hours-admission" },
};

afterEach(cleanup);

const page = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
      {node}
    </NextIntlClientProvider>
  );

// The note is on every card a plan's stop is drawn with: the plan's and the saved trip's.
describe("a stop the checked list shuts on a date of the trip", () => {
  it.each([
    ["the plan's card", () => <ActivityCard activity={louvre} index={0} currency="EUR" showGallery={false} />],
    [
      "the saved trip's card",
      () => (
        <EditableActivityCard
          activity={louvre}
          index={0}
          currency="EUR"
          showGallery={false}
          isEditMode={false}
          onDelete={() => {}}
          onUpdate={() => {}}
          onMoveToDay={() => {}}
          onRegenerate={() => {}}
          availableDays={[1, 2]}
          currentDayIndex={0}
        />
      ),
    ],
  ])("says so on %s", (_where, card) => {
    page(card());
    expect(screen.getByText(/Closed Tue, Dec 15/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Official hours" })).toBeTruthy();
  });

  it("says nothing on a stop with no closing", () => {
    const { closing: _closing, ...open } = louvre;
    page(<ActivityCard activity={open} index={0} currency="EUR" showGallery={false} />);
    expect(screen.queryByText(/Closed /)).toBeNull();
  });
});
