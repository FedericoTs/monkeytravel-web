import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";

vi.mock("@/hooks/useActivitySearch", () => ({
  useActivitySearch: () => ({
    query: "",
    category: null,
    results: [],
    isSearching: false,
    changeQuery: vi.fn(),
    toggleCategory: vi.fn(),
    reset: vi.fn(),
  }),
}));

import AddActivityButton from "./AddActivityButton";

function openForm(suggestedTime?: string) {
  const onAdd = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
      <AddActivityButton dayIndex={0} destination="Kyoto, Japan" onAdd={onAdd} suggestedTime={suggestedTime} />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: enCommon.addActivity.title }));
  fireEvent.click(screen.getByRole("button", { name: `+ ${enCommon.addActivity.addCustom}` }));
  return onAdd;
}

const startField = () => screen.getByLabelText(enCommon.activity.startTime) as HTMLInputElement;

describe("AddActivityButton's own stop", () => {
  // Stops added or moved since the page loaded change the day's next free slot.
  it("opens on the next free slot of the day as it is now", () => {
    const ui = (suggestedTime: string) => (
      <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
        <AddActivityButton dayIndex={0} destination="Kyoto, Japan" onAdd={vi.fn()} suggestedTime={suggestedTime} />
      </NextIntlClientProvider>
    );
    const view = render(ui("10:00"));
    view.rerender(ui("21:30"));
    fireEvent.click(screen.getByRole("button", { name: enCommon.addActivity.title }));
    fireEvent.click(screen.getByRole("button", { name: `+ ${enCommon.addActivity.addCustom}` }));
    expect(startField().value).toBe("21:30");
  });

  it("opens on the day's next free slot, and adds the stop at the time picked", () => {
    const onAdd = openForm("21:30");
    expect(startField().value).toBe("21:30");

    fireEvent.change(startField(), { target: { value: "15:00" } });
    fireEvent.change(screen.getByLabelText(enCommon.addActivity.activityNameRequired), { target: { value: "Check in at the ryokan" } });
    fireEvent.click(screen.getByRole("button", { name: enCommon.addActivity.add }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: "Check in at the ryokan", start_time: "15:00" }));
  });
});
