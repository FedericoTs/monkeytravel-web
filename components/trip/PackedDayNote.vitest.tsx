import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => (values?.time ? `${key}:${values.time}` : key),
}));

import { PackedDayNote } from "./PackedDayNote";

const stops = (n: number, minutes = 60) => Array.from({ length: n }, () => ({ duration_minutes: minutes }));

afterEach(cleanup);

describe("PackedDayNote", () => {
  it("says nothing on a day within its pace", () => {
    const { container } = render(<PackedDayNote activities={stops(4, 120)} pace="moderate" onLighten={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("says a day past its budget is packed, by how much, and offers to lighten it", () => {
    const onLighten = vi.fn();
    render(<PackedDayNote activities={stops(5, 130)} pace="moderate" onLighten={onLighten} className="mb-3" />);
    expect(screen.getByText("daySummary.overpacked")).toBeTruthy();
    expect(screen.getByText(/daySummary\.planned:10 h 50 min/)).toBeTruthy();
    expect(screen.getByText(/daySummary\.ofBudget:8 h/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "daySummary.lighten" }));
    expect(onLighten).toHaveBeenCalledTimes(1);
    expect(screen.getByText("daySummary.overpacked").parentElement?.className).toContain("mb-3");
  });

  it("calls too many stops packed too, however short they are", () => {
    render(<PackedDayNote activities={stops(6, 30)} pace="moderate" onLighten={() => {}} />);
    expect(screen.getByText("daySummary.overpacked")).toBeTruthy();
  });

  it("judges by the trip's own pace", () => {
    const day = stops(5, 100);
    const { container, rerender } = render(<PackedDayNote activities={day} pace="active" onLighten={() => {}} />);
    expect(container.innerHTML).toBe("");
    rerender(<PackedDayNote activities={day} pace="relaxed" onLighten={() => {}} />);
    expect(screen.getByText(/daySummary\.ofBudget:6 h/)).toBeTruthy();
  });

  it("takes an unknown pace as moderate", () => {
    render(<PackedDayNote activities={stops(6, 30)} pace={undefined} onLighten={() => {}} />);
    expect(screen.getByText(/daySummary\.ofBudget:8 h/)).toBeTruthy();
  });
});
