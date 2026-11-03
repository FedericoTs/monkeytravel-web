import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

import DayActions from "./DayActions";

/**
 * The end of a day's header: regenerate the day, optimize its route, and its
 * estimated budget, each only when the page gives it.
 */

const REGENERATE = 'detail.regenerateDay.button {"number":2}';

afterEach(cleanup);

describe("DayActions", () => {
  it("offers regenerating the day, optimizing its route and its budget", () => {
    const onRegenerate = vi.fn();
    const onOptimizeRoute = vi.fn();
    render(
      <DayActions dayNumber={2} regeneratingDayNumber={null} onRegenerate={onRegenerate} onOptimizeRoute={onOptimizeRoute} budget="€60" />
    );
    fireEvent.click(screen.getByRole("button", { name: REGENERATE }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle("detail.optimizeRoute"));
    expect(onOptimizeRoute).toHaveBeenCalledTimes(1);
    expect(screen.getByText("€60")).toBeTruthy();
    expect(screen.getByText("detail.estBudget")).toBeTruthy();
  });

  it("shows only what it is given", () => {
    const { container } = render(
      <DayActions dayNumber={2} regeneratingDayNumber={null} onRegenerate={null} onOptimizeRoute={null} budget={null} />
    );
    expect(container.firstElementChild!.childElementCount).toBe(0);
  });

  it("while this day regenerates, its button spins and is off", () => {
    render(<DayActions dayNumber={2} regeneratingDayNumber={2} onRegenerate={vi.fn()} onOptimizeRoute={null} budget={null} />);
    const button = screen.getByRole("button", { name: REGENERATE }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector("svg")!.getAttribute("class")).toContain("animate-spin");
  });

  it("while another day regenerates, its button is off and still", () => {
    render(<DayActions dayNumber={2} regeneratingDayNumber={4} onRegenerate={vi.fn()} onOptimizeRoute={null} budget={null} />);
    const button = screen.getByRole("button", { name: REGENERATE }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector("svg")!.getAttribute("class")).not.toContain("animate-spin");
  });

  it("names the optimize button in full from small screens up, and shortly below", () => {
    render(<DayActions dayNumber={2} regeneratingDayNumber={null} onRegenerate={null} onOptimizeRoute={vi.fn()} budget={null} />);
    const button = screen.getByTitle("detail.optimizeRoute");
    expect(button.querySelector(".sm\\:inline")!.textContent).toBe("detail.optimizeRoute");
    expect(button.querySelector(".sm\\:hidden")!.textContent).toBe("detail.optimize");
  });
});
