import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enTrips from "@/messages/en/trips.json";
import enCommon from "@/messages/en/common.json";
import ChangeDatesModal from "./ChangeDatesModal";

function open(newDaysEmpty?: boolean) {
  const onConfirm = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ trips: enTrips, common: enCommon }}>
      <ChangeDatesModal
        isOpen
        onClose={() => {}}
        startDate="2026-12-21"
        endDate="2026-12-24"
        currentDays={4}
        maxDays={14}
        minDate="2026-11-09"
        maxStartDate="2028-11-09"
        onConfirm={onConfirm}
        newDaysEmpty={newDaysEmpty}
      />
    </NextIntlClientProvider>
  );
  fireEvent.change(screen.getByLabelText(enTrips.wizard.changeDates.end), { target: { value: "2026-12-26" } });
  return onConfirm;
}

describe("ChangeDatesModal", () => {
  // A saved trip has no assistant waiting to plan the new days: they come empty.
  it("says the new days of a longer saved trip come empty", () => {
    const onConfirm = open(true);
    expect(screen.getByText(/the new ones from Day 5 start empty/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: enTrips.wizard.changeDates.confirm }));
    expect(onConfirm).toHaveBeenCalledWith("2026-12-21", "2026-12-26");
  });

  it("says the assistant plans them in the planner", () => {
    open();
    expect(screen.getByText(/the assistant plans the new ones from Day 5/)).toBeTruthy();
  });
});

describe("ChangeDatesModal opened on the dates asked for", () => {
  it("starts from them, and confirms them as they are", () => {
    const onConfirm = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ trips: enTrips, common: enCommon }}>
        <ChangeDatesModal
          isOpen
          onClose={() => {}}
          startDate="2026-12-21"
          endDate="2026-12-24"
          currentDays={4}
          maxDays={14}
          minDate="2026-11-09"
          maxStartDate="2028-11-09"
          onConfirm={onConfirm}
          newDaysEmpty
          initialStart="2026-12-21"
          initialEnd="2026-12-26"
        />
      </NextIntlClientProvider>
    );
    expect((screen.getByLabelText(enTrips.wizard.changeDates.end) as HTMLInputElement).value).toBe("2026-12-26");
    expect(screen.getByText(/the new ones from Day 5 start empty/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: enTrips.wizard.changeDates.confirm }));
    expect(onConfirm).toHaveBeenCalledWith("2026-12-21", "2026-12-26");
  });
});
