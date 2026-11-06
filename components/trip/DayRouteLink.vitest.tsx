import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const capture = vi.fn();
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/posthog", () => ({ capture: (...args: unknown[]) => capture(...args) }));

import { DayRouteLink } from "./DayRouteLink";

const two = [
  { name: "A", location: "Lisbon" },
  { name: "B", location: "Lisbon" },
];

beforeEach(() => capture.mockReset());
afterEach(cleanup);

describe("DayRouteLink", () => {
  it("opens the day's route in a new tab, by its name", () => {
    render(<DayRouteLink activities={two} surface="result" />);
    const link = screen.getByRole("link", { name: "day.route" }) as HTMLAnchorElement;
    expect(link.href).toContain("https://www.google.com/maps/dir/");
    expect(link.href).toContain("origin=A%2C%20Lisbon");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("isn't there for a day with one stop", () => {
    const { container } = render(<DayRouteLink activities={[two[0]]} surface="result" />);
    expect(container.innerHTML).toBe("");
  });

  it("records which page it was opened from", () => {
    render(<DayRouteLink activities={two} surface="today" />);
    fireEvent.click(screen.getByRole("link"));
    expect(capture).toHaveBeenCalledWith("day_route_opened", { surface: "today" });
  });

  it("takes the place's spacing", () => {
    render(<DayRouteLink activities={two} surface="result" className="mb-3" />);
    expect(screen.getByRole("link").className).toContain("mb-3");
  });
});
