import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, render } from "@testing-library/react";

// The limits the dates field hands its calendar: the calendar itself is tested in components/ui.
const given: Array<{ maxDays?: number; placeMaxDays?: number; routeMaxDays?: number }> = [];
vi.mock("@/components/ui/DateRangePicker", () => ({
  default: (props: { maxDays?: number; placeMaxDays?: number; routeMaxDays?: number }) => {
    given.push(props);
    return null;
  },
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import TripDatesField from "./TripDatesField";

afterEach(() => {
  cleanup();
  given.length = 0;
});

function field(limits: { effectiveMaxTripDays: number; datesMaxDays?: number; routeMaxDays?: number }) {
  render(
    <TripDatesField
      multiCity={false}
      startDate=""
      setStartDate={() => {}}
      endDate=""
      setEndDate={() => {}}
      maxStartDate="2028-01-01"
      cityRows={[]}
      dateTriggerRef={createRef()}
      trackFieldInteraction={() => {}}
      flexibleDates={false}
      setFlexibleDates={() => {}}
      datesPencilled={false}
      setDatesPencilled={() => {}}
      handleFlexibleDates={() => {}}
      {...limits}
    />
  );
  return given[given.length - 1];
}

describe("the trip dates field", () => {
  // A country typed: a route may take three weeks, while one place stops at two.
  it("lets the dates run to a route's length and keeps one place's limit for the calendar's line", () => {
    expect(field({ effectiveMaxTripDays: 14, datesMaxDays: 21, routeMaxDays: 21 })).toMatchObject({
      maxDays: 21,
      placeMaxDays: 14,
      routeMaxDays: 21,
    });
  });

  it("holds the dates to the trip's limit when nothing longer is open", () => {
    expect(field({ effectiveMaxTripDays: 14, routeMaxDays: 21 })).toMatchObject({ maxDays: 14, placeMaxDays: 14 });
  });
});
