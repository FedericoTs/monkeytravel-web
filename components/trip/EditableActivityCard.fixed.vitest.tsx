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
  time_slot: "evening",
  start_time: "19:30",
  duration_minutes: 150,
  name: "Kabuki at Minamiza",
  type: "entertainment",
  description: "The December kaomise show.",
  location: "Gion",
  tips: [],
  booking_required: false,
  estimated_cost: { amount: 0, currency: "USD", tier: "free" },
};

const shown = (activity: Activity, isEditMode: boolean) => (
  <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
    <EditableActivityCard
      activity={activity}
      index={0}
      currency="USD"
      showGallery={false}
      isEditMode={isEditMode}
      onDelete={() => {}}
      onUpdate={() => {}}
      onMoveToDay={() => {}}
      onRegenerate={() => {}}
      availableDays={[1, 2]}
      currentDayIndex={0}
    />
  </NextIntlClientProvider>
);
const card = (activity: Activity, isEditMode: boolean) => render(shown(activity, isEditMode));

afterEach(cleanup);

// A fixed plan is one the traveller gave (a show, a flight): the page never
// moves its time. The card says so, as the timeline does.
describe("EditableActivityCard's fixed plan", () => {
  it("is marked, in and out of edit mode", () => {
    for (const isEditMode of [false, true]) {
      card({ ...stop, locked: true }, isEditMode);
      expect(screen.getByLabelText(enCommon.lockedActivity).textContent).toBe("📌");
      expect(screen.getByRole("heading").textContent).toContain(stop.name);
      cleanup();
    }
  });

  it("is the only stop marked", () => {
    card(stop, true);
    expect(screen.queryByLabelText(enCommon.lockedActivity)).toBeNull();
  });

  it("is marked once the stop becomes one, and no longer once it isn't", () => {
    const { rerender } = card(stop, true);
    rerender(shown({ ...stop, locked: true }, true));
    expect(screen.getByLabelText(enCommon.lockedActivity)).toBeTruthy();
    rerender(shown(stop, true));
    expect(screen.queryByLabelText(enCommon.lockedActivity)).toBeNull();
  });
});
