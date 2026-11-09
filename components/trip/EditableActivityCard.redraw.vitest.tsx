import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";

vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `${from} ${amount}` }) }),
}));

import EditableActivityCard from "./EditableActivityCard";

const stop: Activity = {
  id: "a1",
  time_slot: "afternoon",
  start_time: "12:30",
  duration_minutes: 75,
  name: "Lunch at Nishiki Market",
  type: "restaurant",
  description: "Skewers and pickles.",
  location: "Kyoto",
  address: "Nakagyo",
  tips: [],
  booking_required: false,
  estimated_cost: { amount: 20, currency: "USD", tier: "moderate" },
};

const shown = (activity: Activity) => (
  <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
    <EditableActivityCard
      activity={activity}
      index={0}
      currency="USD"
      showGallery={false}
      isEditMode
      onDelete={() => {}}
      onUpdate={() => {}}
      onMoveToDay={() => {}}
      onRegenerate={() => {}}
      availableDays={[1, 2]}
      currentDayIndex={0}
    />
  </NextIntlClientProvider>
);

afterEach(cleanup);

// The assistant or a refetch can change a stop's price, place or booking and
// nothing else: the card shows the stop as it is now.
describe("EditableActivityCard redrawn", () => {
  it("shows a new price, place or booking, whatever else stayed the same", () => {
    const { rerender } = render(shown(stop));
    expect(screen.getByText("USD 20")).toBeTruthy();

    rerender(shown({ ...stop, estimated_cost: { amount: 35, currency: "USD", tier: "moderate" } }));
    expect(screen.getByText("USD 35")).toBeTruthy();

    rerender(shown({ ...stop, estimated_cost: { amount: 35, currency: "USD", tier: "moderate" }, address: "Gion" }));
    expect(screen.getByText("Gion")).toBeTruthy();

    rerender(shown({ ...stop, booking_required: true }));
    expect(screen.getByText(enTrips.activity.booking)).toBeTruthy();
  });
});
