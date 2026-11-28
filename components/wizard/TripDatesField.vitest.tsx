import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";

// The limits the dates field hands its calendar: the calendar itself is tested in components/ui.
const given: Array<{ maxDays?: number; placeMaxDays?: number; routeMaxDays?: number }> = [];
vi.mock("@/components/ui/DateRangePicker", () => ({
  default: (props: { maxDays?: number; placeMaxDays?: number; routeMaxDays?: number }) => {
    given.push(props);
    return null;
  },
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));

import en from "@/messages/en/trips.json";
import es from "@/messages/es/trips.json";
import it_ from "@/messages/it/trips.json";
import pt from "@/messages/pt/trips.json";
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

// Each city's nights are that many days of the plan, so the total counts days: 3 + 3 from 15 April ends on the 20th.
describe("a route's total", () => {
  function route() {
    render(
      <TripDatesField
        multiCity
        startDate="2027-04-15"
        setStartDate={() => {}}
        endDate="2027-04-20"
        setEndDate={() => {}}
        maxStartDate="2028-01-01"
        cityRows={[
          { city: "Lisbon", nights: 3 },
          { city: "Porto", nights: 3 },
        ]}
        dateTriggerRef={createRef()}
        trackFieldInteraction={() => {}}
        flexibleDates={false}
        setFlexibleDates={() => {}}
        datesPencilled={false}
        setDatesPencilled={() => {}}
        handleFlexibleDates={() => {}}
        effectiveMaxTripDays={21}
      />
    );
  }

  it("counts the days the plan has, next to the day it ends", () => {
    route();
    expect(screen.getByText(/wizard\.multiCity\.daysTotal \{"count":6\}/)).toBeTruthy();
    expect(screen.getByText(/wizard\.multiCity\.endsOn \{"date":"2027-04-20"\}/)).toBeTruthy();
    expect(screen.queryByText(/nightsTotal/)).toBeNull();
  });

  it("says days in every language", () => {
    expect(en.wizard.multiCity.daysTotal).toContain("# days");
    expect(es.wizard.multiCity.daysTotal).toContain("# días");
    expect(it_.wizard.multiCity.daysTotal).toContain("# giorni");
    expect(pt.wizard.multiCity.daysTotal).toContain("# dias");
  });
});
