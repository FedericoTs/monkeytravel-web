import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  start_time: "16:15",
  duration_minutes: 60,
  name: "Sannenzaka and Ninenzaka",
  type: "attraction",
  description: "Stone lanes of old Kyoto.",
  location: "Higashiyama",
  tips: [],
  booking_required: false,
  estimated_cost: { amount: 0, currency: "USD", tier: "free" },
};

describe("EditableActivityCard's Delete", () => {
  // The page says what was removed, with an Undo: no question comes first.
  it("removes the stop at once", () => {
    const onDelete = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
        <EditableActivityCard
          activity={stop}
          index={0}
          currency="USD"
          showGallery={false}
          isEditMode
          onDelete={onDelete}
          onUpdate={() => {}}
          onMoveToDay={() => {}}
          onRegenerate={() => {}}
          availableDays={[1, 2]}
          currentDayIndex={0}
        />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: enTrips.editActivity.moreActions }));
    fireEvent.click(screen.getByRole("menuitem", { name: enTrips.editActivity.deleteActivity }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: stop.name })).toBeTruthy();
  });
});
