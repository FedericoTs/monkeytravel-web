import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";

import TripStrip, { type TripStripItem } from "./TripStrip";

// A card that counts how often it mounts, and keeps a tick while it lives.
const mounts: Record<string, number> = {};
function Card({ name }: { name: string }) {
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
  }, [name]);
  return (
    <div data-testid={`card-${name}`}>
      <button type="button" onClick={() => setTicked(true)}>
        tick {name}
      </button>
      {ticked && <span>ticked {name}</span>}
    </div>
  );
}

const items = (): TripStripItem[] => [
  { id: "who", label: "Who's going", detail: "2 going", content: <Card name="who" />, keepMounted: true },
  { id: "ready", label: "Trip preparation", content: <Card name="ready" /> },
  { id: "book", label: "Book ahead", detail: "0 of 1 booked", content: <Card name="book" />, keepMounted: true },
];
const chip = (id: string) => screen.getByTestId(`trip-strip-${id}`);

/**
 * The saved trip page keeps the plan first: what used to sit above it as cards
 * is one row of chips, each opening its card on a tap.
 */
describe("the trip page's strip", () => {
  it("shows every chip closed, with its count, and no card", () => {
    render(<TripStrip label="Getting ready" items={items()} />);
    expect(screen.getByRole("region", { name: "Getting ready" })).toBeTruthy();
    for (const id of ["who", "ready", "book"]) expect(chip(id).getAttribute("aria-expanded")).toBe("false");
    expect(chip("who").textContent).toContain("Who's going");
    expect(chip("who").textContent).toContain("2 going");
    expect(chip("ready").textContent).toBe("Trip preparation");
    // Kept cards are in the page but hidden; the other one isn't there yet.
    expect(screen.getByTestId("card-who").closest("[hidden]")).not.toBeNull();
    expect(screen.getByTestId("card-book").closest("[hidden]")).not.toBeNull();
    expect(screen.queryByTestId("card-ready")).toBeNull();
  });

  it("opens a chip's card under the row, and names it for a screen reader", () => {
    render(<TripStrip label="Getting ready" items={items()} />);
    fireEvent.click(chip("ready"));
    expect(chip("ready").getAttribute("aria-expanded")).toBe("true");
    const card = screen.getByTestId("card-ready");
    expect(card.closest("[hidden]")).toBeNull();
    expect(card.parentElement?.id).toBe(chip("ready").getAttribute("aria-controls"));
  });

  it("keeps one card open at a time, and closes it on a second tap", () => {
    render(<TripStrip label="Getting ready" items={items()} />);
    fireEvent.click(chip("who"));
    fireEvent.click(chip("book"));
    expect(chip("who").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("card-who").closest("[hidden]")).not.toBeNull();
    expect(screen.getByTestId("card-book").closest("[hidden]")).toBeNull();
    fireEvent.click(chip("book"));
    expect(chip("book").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("card-book").closest("[hidden]")).not.toBeNull();
  });

  it("keeps a kept card's state while it is closed, and mounts the others when opened", () => {
    mounts.book = 0;
    mounts.ready = 0;
    render(<TripStrip label="Getting ready" items={items()} />);
    fireEvent.click(chip("book"));
    fireEvent.click(screen.getByText("tick book"));
    fireEvent.click(chip("ready"));
    fireEvent.click(chip("book"));
    expect(screen.getByText("ticked book")).toBeTruthy();
    expect(mounts.book).toBe(1);
    expect(mounts.ready).toBe(1);
    expect(screen.queryByTestId("card-ready")).toBeNull();
  });

  it("is nothing when the trip has no chip to show", () => {
    const { container } = render(<TripStrip label="Getting ready" items={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
