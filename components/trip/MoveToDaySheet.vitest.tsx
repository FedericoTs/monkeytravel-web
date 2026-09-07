import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MoveToDaySheet, { formatDayDate } from "./MoveToDaySheet";

/**
 * The explicit "Move to another day" path. The sheet must list every day with
 * enough context to choose (date, count, "empty"), refuse the current day,
 * and hand back the picked day number.
 */
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => "en",
}));

const days = [
  { dayNumber: 1, date: "2026-10-01", count: 3 },
  { dayNumber: 2, date: "2026-10-02", count: 0 },
  { dayNumber: 3, date: "2026-10-03", city: "Porto", count: 2 },
];

describe("MoveToDaySheet", () => {
  it("lists every day with its date, count or 'empty', and city", () => {
    render(
      <MoveToDaySheet isOpen onClose={() => {}} activityName="Louvre" days={days} currentDayNumber={1} onPick={() => {}} />,
    );
    expect(screen.getByText("Louvre")).toBeTruthy();
    expect(screen.getByTestId("move-to-day-1").textContent).toContain('activityCount:{"count":3}');
    expect(screen.getByTestId("move-to-day-2").textContent).toContain("editActivity.emptyDay");
    expect(screen.getByTestId("move-to-day-3").textContent).toContain("Porto");
    expect(screen.getByTestId("move-to-day-3").textContent).toContain("Oct");
  });

  it("disables the current day and marks it", () => {
    render(
      <MoveToDaySheet isOpen onClose={() => {}} activityName="Louvre" days={days} currentDayNumber={2} onPick={() => {}} />,
    );
    const current = screen.getByTestId("move-to-day-2") as HTMLButtonElement;
    expect(current.disabled).toBe(true);
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(current.textContent).toContain("editActivity.currentDay");
    expect((screen.getByTestId("move-to-day-1") as HTMLButtonElement).disabled).toBe(false);
  });

  it("hands back the picked day number", () => {
    const onPick = vi.fn();
    render(
      <MoveToDaySheet isOpen onClose={() => {}} activityName="Louvre" days={days} currentDayNumber={1} onPick={onPick} />,
    );
    fireEvent.click(screen.getByTestId("move-to-day-3"));
    expect(onPick).toHaveBeenCalledWith(3);
  });

  it("renders nothing while closed", () => {
    render(
      <MoveToDaySheet isOpen={false} onClose={() => {}} activityName="Louvre" days={days} currentDayNumber={1} onPick={() => {}} />,
    );
    expect(screen.queryByTestId("move-to-day-list")).toBeNull();
  });
});

describe("formatDayDate", () => {
  it("formats an ISO date as a short weekday + date without timezone drift", () => {
    expect(formatDayDate("2026-10-02", "en")).toMatch(/Fri/);
    expect(formatDayDate("2026-10-02", "en")).toMatch(/2/);
    expect(formatDayDate(undefined, "en")).toBeNull();
    expect(formatDayDate("not-a-date", "en")).toBeNull();
  });
});
