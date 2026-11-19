import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/**
 * While the end date is picked, the days past the longest trip are greyed out and a line says why. In the planner a
 * place can also be planned as a trip through several cities, which may run longer: the line says so, so someone
 * who wants three weeks learns the way to them instead of leaving at the limit.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
  useLocale: () => "en",
}));

import DateRangePicker from "./DateRangePicker";

function Picker({ routeMaxDays, maxDays = 14, placeMaxDays }: { routeMaxDays?: number; maxDays?: number; placeMaxDays?: number }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  return (
    <DateRangePicker
      startDate={start}
      endDate={end}
      onStartDateChange={setStart}
      onEndDateChange={setEnd}
      minDate="2026-10-14"
      maxDays={maxDays}
      placeMaxDays={placeMaxDays}
      routeMaxDays={routeMaxDays}
    />
  );
}

const pickStart = () => {
  fireEvent.click(screen.getByRole("button", { name: /checkInLabel/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "20" })[0]);
};

afterEach(cleanup);

describe("the line under the days while the end date is picked", () => {
  it("names the longer trip through several cities when the planner offers one", () => {
    render(<Picker routeMaxDays={21} />);
    pickStart();
    expect(screen.getByText('maxDaysOrRoute {"days":14,"route":21}')).toBeTruthy();
    expect(screen.queryByText(/^maxDaysLimit/)).toBeNull();
  });

  // A country typed, which a route may take: the days run to the route's 21, and one place still stops at 14.
  it("names one place's limit beside the route's when the days may run to the route's", () => {
    render(<Picker maxDays={21} placeMaxDays={14} routeMaxDays={21} />);
    pickStart();
    expect(screen.getByText('maxDaysOrRoute {"days":14,"route":21}')).toBeTruthy();
    expect(screen.queryByText(/^maxDaysLimit/)).toBeNull();
  });

  it("says only the limit elsewhere, or when several cities allow no more", () => {
    render(<Picker />);
    pickStart();
    expect(screen.getByText('maxDaysLimit {"days":14}')).toBeTruthy();
    cleanup();

    render(<Picker routeMaxDays={14} />);
    pickStart();
    expect(screen.getByText('maxDaysLimit {"days":14}')).toBeTruthy();
  });
});
