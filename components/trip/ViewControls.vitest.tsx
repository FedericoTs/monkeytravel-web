import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { MapToggle, ViewModeToggle } from "./ViewControls";

const labels = { cards: "Cards", timeline: "Timeline" };

describe("the cards/timeline switch", () => {
  it("is a named group whose buttons say which view is shown", () => {
    render(<ViewModeToggle value="timeline" onChange={() => {}} labels={labels} />);
    expect(screen.getByRole("group", { name: "detail.viewToggle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cards" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Timeline" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps both views reachable by keyboard", () => {
    render(<ViewModeToggle value="cards" onChange={() => {}} labels={labels} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("tabindex")).toBeNull();
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("asks for the view whose button is clicked", () => {
    const onChange = vi.fn();
    render(<ViewModeToggle value="cards" onChange={onChange} labels={labels} />);
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    expect(onChange.mock.calls).toEqual([["timeline"], ["cards"]]);
  });

  it("puts a view's icon before its label", () => {
    render(
      <ViewModeToggle
        value="cards"
        onChange={() => {}}
        labels={labels}
        icons={{ cards: <i data-testid="grid" />, timeline: <i data-testid="list" /> }}
      />
    );
    const cards = screen.getByRole("button", { name: "Cards" });
    expect(cards.firstElementChild).toBe(screen.getByTestId("grid"));
    expect(screen.getByRole("button", { name: "Timeline" }).firstElementChild).toBe(screen.getByTestId("list"));
  });
});

describe("the map button", () => {
  const mapLabels = { show: "Show map", hide: "Hide map" };

  it("offers to show a hidden map and to hide a shown one", () => {
    const { rerender } = render(<MapToggle shown={false} onToggle={() => {}} labels={mapLabels} />);
    expect(screen.getByRole("button").getAttribute("title")).toBe("Show map");
    expect(screen.getByText("Show map")).toBeTruthy();
    rerender(<MapToggle shown onToggle={() => {}} labels={mapLabels} />);
    expect(screen.getByRole("button").getAttribute("title")).toBe("Hide map");
    expect(screen.getByText("Hide map")).toBeTruthy();
  });

  it("toggles the map when clicked", () => {
    const onToggle = vi.fn();
    render(<MapToggle shown onToggle={onToggle} labels={mapLabels} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("draws a map icon hidden from screen readers unless the view brings its own", () => {
    const { container, rerender } = render(<MapToggle shown={false} onToggle={() => {}} labels={mapLabels} />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<MapToggle shown={false} onToggle={() => {}} labels={mapLabels} icon={<i data-testid="own" />} />);
    expect(screen.getByTestId("own")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
});
