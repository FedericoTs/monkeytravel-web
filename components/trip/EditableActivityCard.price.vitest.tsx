import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";
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
  const label = screen.getByText(enTrips.activity.aiEstimate, { selector: "div.text-\\[10px\\]" });
  return label.parentElement!.textContent!.replace(label.textContent!, "");
}

describe("EditableActivityCard's price", () => {
  it("shows the AI estimate in the activity's currency", () => {
    expect(priceOf({ amount: 25, currency: "EUR", tier: "moderate" })).toBe("~EUR 25");
  });

  it("says free for a zero estimate", () => {
    expect(priceOf({ amount: 0, currency: "EUR", tier: "free" })).toBe(`~${enTrips.activity.free}`);
  });

  it("names a missing estimate rather than inventing one", () => {
    expect(priceOf(undefined)).toBe(`~${enTrips.activity.aiEstimate}`);
  });
});
