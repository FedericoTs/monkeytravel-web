import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

import { EditModeNotice, NoItinerary, RegeneratingDayOverlay, ReorderHint, SaveSuccessToast } from "./TripNotices";

/** The trip page's static notices, each saying what the page shows it for. */

afterEach(cleanup);

describe("TripNotices", () => {
  it("RegeneratingDayOverlay announces the day being regenerated", () => {
    const { container } = render(<RegeneratingDayOverlay dayNumber={3} />);
    expect(screen.getByText('detail.regeneratingDay {"number":3}')).toBeTruthy();
    expect(container.firstElementChild!.getAttribute("aria-live")).toBe("polite");
  });

  it("ReorderHint says the activities can be put in order", () => {
    render(<ReorderHint />);
    expect(screen.getByText("detail.reorderActivities")).toBeTruthy();
  });

  it("NoItinerary says the trip has no plan yet, and what to do", () => {
    render(<NoItinerary />);
    expect(screen.getByRole("heading", { name: "detail.noItinerary" })).toBeTruthy();
    expect(screen.getByText("detail.noItineraryMessage")).toBeTruthy();
  });

  it("EditModeNotice says edit mode is on and how it works", () => {
    render(<EditModeNotice />);
    expect(screen.getByRole("heading", { name: "detail.editModeActive" })).toBeTruthy();
    expect(screen.getByText("detail.editModeInstructions")).toBeTruthy();
  });

  it("SaveSuccessToast says the changes are saved and the trip updated, and can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<SaveSuccessToast onDismiss={onDismiss} />);
    expect(screen.getByText("detail.changesSaved")).toBeTruthy();
    expect(screen.getByText("detail.tripUpdated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
