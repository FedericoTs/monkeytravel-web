import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";

vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `${from}→GBP ${amount}` }) }),
}));

import EditableActivityCard from "./EditableActivityCard";

function priceOf(estimated_cost: Activity["estimated_cost"]) {
  const activity: Activity = {
    id: "a1",
    time_slot: "morning",
    start_time: "09:00",
    duration_minutes: 90,
    name: "Museo del Prado",
    type: "museum",
    description: "Spanish masters.",
    location: "Madrid",
    tips: [],
    booking_required: false,
    estimated_cost,
  };
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
      <EditableActivityCard
        activity={activity}
        index={0}
        currency="USD"
        showGallery={false}
        isEditMode={false}
        onDelete={() => {}}
        onUpdate={() => {}}
        onMoveToDay={() => {}}
        onRegenerate={() => {}}
        availableDays={[1]}
        currentDayIndex={0}
      />
    </NextIntlClientProvider>
  );
  const label = screen.queryByText(enTrips.activity.aiEstimate, { selector: "div.text-\\[10px\\]" });
  return label && label.parentElement!.textContent!.replace(label.textContent!, "");
}

describe("EditableActivityCard's price", () => {
  it("shows the AI estimate converted to the viewer's currency", () => {
    expect(priceOf({ amount: 25, currency: "EUR", tier: "moderate" })).toBe("~EUR→GBP 25");
  });

  it("converts from the trip's currency when the estimate names none", () => {
    expect(priceOf({ amount: 25, currency: "", tier: "moderate" })).toBe("~USD→GBP 25");
  });

  it("says free for a zero estimate", () => {
    expect(priceOf({ amount: 0, currency: "EUR", tier: "free" })).toBe(`~${enCommon.activity.free}`);
  });

  it("shows no price for a missing estimate rather than inventing one", () => {
    expect(priceOf(undefined)).toBeNull();
    expect(screen.queryByText(enCommon.activity.free)).toBeNull();
  });
});
