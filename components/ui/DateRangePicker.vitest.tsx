import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Reaching a month far ahead on a phone meant tapping 32px arrows, with the
 * month and year arrows side by side; people tapped one for the other and
 * planned the wrong month. The caption now opens a grid of months, and the
 * day view keeps one 44px month arrow on each side.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

import DateRangePicker from "./DateRangePicker";

function openCalendar(props: { startDate?: string; minDate?: string } = {}) {
  render(
    <DateRangePicker
      startDate={props.startDate ?? "2026-11-10"}
      endDate=""
      onStartDateChange={() => {}}
      onEndDateChange={() => {}}
      minDate={props.minDate ?? "2026-10-14"}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /checkInLabel/ }));
}

const caption = () => screen.getByRole("button", { name: /chooseMonth/ });

describe("jumping to a month", () => {
  it("opens a grid of months from the caption, and shows the month picked", () => {
    openCalendar();
    expect(caption().textContent).toContain("November 2026");
    fireEvent.click(caption());
    fireEvent.click(screen.getByRole("button", { name: "December" }));
    expect(caption().textContent).toContain("December 2026");
    expect(screen.getByRole("button", { name: "31" })).toBeTruthy();
  });

  it("reaches next year's months in two taps", () => {
    openCalendar();
    fireEvent.click(caption());
    fireEvent.click(screen.getByRole("button", { name: "nextYear" }));
    fireEvent.click(screen.getByRole("button", { name: "March" }));
    expect(caption().textContent).toContain("March 2027");
  });

  it("does not offer months before the earliest date", () => {
    openCalendar();
    fireEvent.click(caption());
    expect((screen.getByRole("button", { name: "September" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "October" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "previousYear" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the day view's arrows", () => {
  it("are one month arrow per side, 44px, with no year arrows beside them", () => {
    openCalendar();
    for (const name of ["previousMonth", "nextMonth"]) {
      const arrow = screen.getByRole("button", { name });
      expect(arrow.className).toContain("w-11");
      expect(arrow.className).toContain("h-11");
    }
    expect(screen.queryByRole("button", { name: "previousYear" })).toBeNull();
    expect(screen.queryByRole("button", { name: "nextYear" })).toBeNull();
  });

  it("still step one month at a time", () => {
    openCalendar();
    fireEvent.click(screen.getByRole("button", { name: "nextMonth" }));
    expect(caption().textContent).toContain("December 2026");
  });
});

describe("the label exists in every language", () => {
  it.each(["en", "es", "it", "pt"])("%s", async (locale) => {
    const messages = (await import(`../../messages/${locale}/trips.json`)).default as {
      wizard: { datePicker: Record<string, string> };
    };
    expect(messages.wizard.datePicker.chooseMonth?.trim()).toBeTruthy();
  });
});
