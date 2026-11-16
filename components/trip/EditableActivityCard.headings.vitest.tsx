import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("EditableActivityCard's heading", () => {
  // The trip page's headings go trip (1), day (2), stop (3): a screen reader
  // moving by headings lands on each stop under its day, with no level skipped.
  it.each([
    ["viewing", false],
    ["editing", true],
  ])("names the stop as a level-3 heading while %s", (_mode, isEditMode) => {
    render(
      <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
        <EditableActivityCard
          activity={stop}
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
    expect(screen.getByRole("heading", { level: 3, name: stop.name })).toBeTruthy();
  });
});
