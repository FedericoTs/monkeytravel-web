import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

import ResultDatesNotice from "./ResultDatesNotice";

const missing = "Days 6–8 could not be planned";
afterEach(cleanup);

describe("ResultDatesNotice", () => {
  it("offers to set dates that were pencilled in", () => {
    const onSetDates = vi.fn();
    render(<ResultDatesNotice planningExtraDays={false} datesNotice={null} dateRange="1 – 5 Jun" onSetDates={onSetDates} />);
    expect(screen.getByText('wizard.changeDates.pencilled {"range":"1 – 5 Jun"}')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "wizard.changeDates.setYourDates" }));
    expect(onSetDates).toHaveBeenCalledTimes(1);
  });

  it("says the trip is being extended, before any other note", () => {
    render(<ResultDatesNotice planningExtraDays datesNotice={missing} dateRange="1 – 5 Jun" onSetDates={vi.fn()} />);
    expect(screen.getByText("wizard.changeDates.planning")).toBeTruthy();
    expect(screen.queryByText(missing)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why a longer trip's extra days are missing", () => {
    render(<ResultDatesNotice planningExtraDays={false} datesNotice={missing} dateRange="1 – 5 Jun" onSetDates={vi.fn()} />);
    expect(screen.getByText(missing)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
