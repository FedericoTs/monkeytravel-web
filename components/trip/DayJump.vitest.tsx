import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import DayJump from "./DayJump";

const moves: { id: string; behavior: ScrollBehavior | undefined }[] = [];
let lessMotion = false;

beforeEach(() => {
  moves.length = 0;
  lessMotion = false;
  Element.prototype.scrollIntoView = function scroll(this: Element, options?: boolean | ScrollIntoViewOptions) {
    moves.push({ id: this.id, behavior: typeof options === "object" ? options.behavior : undefined });
  };
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => (run(0), 0));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: lessMotion && query.includes("prefers-reduced-motion") }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (map?: { onOpen: () => void }) =>
  render(
    <>
      <DayJump
        days={[1, 2, 3]}
        dayId={(day) => `day-${day}`}
        dayLabel={(day) => `Day ${day}`}
        label="Day by day"
        map={map ? { id: "the-map", label: "Show Map", onOpen: map.onOpen } : undefined}
      />
      <div id="day-1" />
      <div id="day-2" />
      <div id="day-3" />
      <div id="the-map" />
    </>,
  );

describe("the days in a row", () => {
  it("is a named way around the plan with a link to each day, in order", () => {
    show();
    const links = within(screen.getByRole("navigation", { name: "Day by day" })).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Day 1", "#day-1"],
      ["Day 2", "#day-2"],
      ["Day 3", "#day-3"],
    ]);
  });

  it("brings the day to the top of the screen on a tap, gently", () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "Day 3" }));
    expect(moves).toEqual([{ id: "day-3", behavior: "smooth" }]);
  });

  it("goes there at once for a reader who asked for less motion", () => {
    lessMotion = true;
    show();
    fireEvent.click(screen.getByRole("link", { name: "Day 2" }));
    expect(moves).toEqual([{ id: "day-2", behavior: "auto" }]);
  });

  it("ends with the map when the page has one, opened before the page goes to it", () => {
    const order: string[] = [];
    Element.prototype.scrollIntoView = function scroll(this: Element) {
      order.push(`to ${this.id}`);
    };
    show({ onOpen: () => order.push("open") });
    const links = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links[3].getAttribute("href")).toBe("#the-map");
    fireEvent.click(screen.getByRole("link", { name: "Show Map" }));
    expect(order).toEqual(["open", "to the-map"]);
  });

  it("gives every link a target a thumb can hit", () => {
    show({ onOpen: () => {} });
    for (const link of screen.getAllByRole("link")) expect(link.className).toContain("min-h-[44px]");
  });
});
